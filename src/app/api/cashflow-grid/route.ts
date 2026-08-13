export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { getMonday, addWeeks, addDays, isInWeek, computeExpectedPaymentDate, parsePaymentCurve, resolveInvoiceForecastAmount, resolveBillForecastAmount } from "@/services/forecast";
import { resolveTenant } from "@/lib/tenant";
import { assembleForecastData } from "@/services/forecast-assembly";
import { computeTypicalDelayWeeks } from "@/services/payment-memory";

export async function GET(req: NextRequest) {
    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Missing or invalid company" }, { status: 401 });

    const requestedCompanyId = req.nextUrl.searchParams.get("companyId");
    if (requestedCompanyId && requestedCompanyId !== tenantId) {
        let isAuthorized = false;
        if (requestedCompanyId.startsWith("org_")) {
            const company = await prisma.company.findUnique({
                where: { clerkOrgId: requestedCompanyId },
                select: { id: true }
            });
            if (company?.id === tenantId) {
                isAuthorized = true;
            }
        }
        if (!isAuthorized) {
            return NextResponse.json({ error: "Forbidden: cross-tenant access denied" }, { status: 403 });
        }
    }
    
    const cid = tenantId;

    try {
        const {
            input,
            forecastResult,
            cashSnapshot,
            overrides,
            invoicesRaw,
            billsRaw,
            customerProfiles,
            vendorProfiles,
            customerPaymentObs,
            recurring,
            assumptions
        } = await assembleForecastData(cid);

        const currentMonday = getMonday(cashSnapshot.asOfDate);
        const today = cashSnapshot.asOfDate;
        const paymentCurve = parsePaymentCurve(assumptions.paymentCurveJson);

        const executionPlan = await prisma.executionPlan.findFirst({
            where: { companyId: cid, status: "approved", weekStart: currentMonday },
            orderBy: { version: "desc" }
        });

        let executionPlanData = null;
        if (executionPlan) {
            let planForecast = null;
            if (executionPlan.forecastStateJson) {
                try {
                    planForecast = JSON.parse(executionPlan.forecastStateJson as string);
                } catch (e) {}
            }
            executionPlanData = {
                id: executionPlan.id,
                version: executionPlan.version,
                createdAt: executionPlan.createdAt.toISOString(),
                approvedBy: executionPlan.approvedBy,
                planForecast
            };
        }

        // Build 13-week timeline
        const weeks = Array.from({ length: 13 }, (_, w) => {
            const weekStart = addWeeks(currentMonday, w);
            const weekEnd = addDays(weekStart, 6);
            return {
                weekNumber: w + 1,
                weekStart: weekStart.toISOString(),
                weekEnd: weekEnd.toISOString(),
            };
        });

        const overridesByTarget = new Map<string, typeof overrides>();
        for (const ov of overrides) {
            if (ov.targetId) {
                if (!overridesByTarget.has(ov.targetId)) overridesByTarget.set(ov.targetId, []);
                overridesByTarget.get(ov.targetId)!.push(ov);
            }
        }

        const customerMap = new Map(customerProfiles.map(c => [c.customerName, c]));
        const vendorMap = new Map(vendorProfiles.map(v => [v.vendorName, v]));
        const obsByCustomer = new Map<string, Array<{ daysEarlyOrLate: number }>>();
        for (const obs of customerPaymentObs) {
            if (!obsByCustomer.has(obs.customerName)) obsByCustomer.set(obs.customerName, []);
            obsByCustomer.get(obs.customerName)!.push(obs);
        }

        // Helper to find the week an item landed in canonically
        function findForecastBreakdownItem(targetId: string, listName: 'inflows' | 'outflows', expectedSourceType: string): { weekNumber: number, item: any } | null {
            for (const w of forecastResult.weeks) {
                const found = w.breakdown[listName].find((i: any) => i.sourceId === targetId && i.sourceType === expectedSourceType);
                if (found) {
                    return { weekNumber: w.weekNumber, item: found };
                }
            }
            return null;
        }

        const enrichedInvoices = invoicesRaw
            .filter(inv => inv.status === "open")
            .map(invRaw => {
                const canonical = input.invoices.find(i => i.id === invRaw.id);
                const isExcluded = !canonical && overridesByTarget.get(invRaw.id)?.some(o => o.type === "exclude");
                const markedPaid = overridesByTarget.get(invRaw.id)?.some(o => o.type === "mark_paid") ?? false;
                const cp = customerMap.get(invRaw.customerName);
                
                // If not in canonical and not excluded/paid, it was fully reconciled away canonically
                const isFullyReconciled = !canonical && !isExcluded && !markedPaid;

                if (markedPaid || isFullyReconciled) return null;

                let effectiveWeek: number | null = null;
                let canonicalExpectedDate: Date | null = null;
                let canonicalConfidence = "low";
                let effectiveAmount = 0;

                if (canonical) {
                    const breakdownMatch = findForecastBreakdownItem(canonical.id, 'inflows', 'invoice');
                    
                    if (breakdownMatch) {
                        effectiveWeek = breakdownMatch.weekNumber;
                        effectiveAmount = breakdownMatch.item.amount;
                        canonicalConfidence = breakdownMatch.item.confidence;
                        const { date } = computeExpectedPaymentDate(canonical as any, today, paymentCurve);
                        canonicalExpectedDate = date;
                    } else {
                        // Backlog or outside 13-week horizon
                        effectiveAmount = resolveInvoiceForecastAmount(canonical);
                        const { date, confidence } = computeExpectedPaymentDate(canonical as any, today, paymentCurve);
                        canonicalExpectedDate = date;
                        canonicalConfidence = confidence;
                    }
                }

                const dueDaysAgo = invRaw.dueDate
                    ? Math.floor((today.getTime() - new Date(invRaw.dueDate).getTime()) / 86400000)
                    : null;

                const moveCount = overridesByTarget.get(invRaw.id)?.filter(o => o.type === "set_expected_payment_date").length || 0;

                return {
                    id: invRaw.id,
                    customerName: invRaw.customerName,
                    invoiceNo: invRaw.invoiceNo,
                    amountOpen: effectiveAmount, // Canonical processed amount
                    originalAmount: invRaw.amountOpen,
                    invoiceDate: invRaw.invoiceDate?.toISOString() ?? null,
                    dueDate: invRaw.dueDate?.toISOString() ?? null,
                    daysPastDue: dueDaysAgo,
                    expectedDate: canonicalExpectedDate?.toISOString() ?? null,
                    effectiveWeek,
                    overrideDate: canonical?.overrideExpectedDate?.toISOString() ?? null,
                    riskTag: canonical?.riskTag ?? cp?.riskTag ?? "low",
                    confidence: canonical ? canonicalConfidence : "low",
                    moveCount,
                    isExcluded: !!isExcluded,
                    isFullyReconciled,
                    kind: "ar" as const,
                };
            }).filter(Boolean);

        const enrichedBills = billsRaw
            .filter(bill => bill.status === "open")
            .map(billRaw => {
                const canonical = input.bills.find(b => b.id === billRaw.id);
                const isExcluded = !canonical && overridesByTarget.get(billRaw.id)?.some(o => o.type === "exclude");
                const markedPaid = overridesByTarget.get(billRaw.id)?.some(o => o.type === "mark_paid") ?? false;
                const vp = vendorMap.get(billRaw.vendorName);
                
                const isFullyReconciled = !canonical && !isExcluded && !markedPaid;

                if (markedPaid || isFullyReconciled) return null;

                let effectiveWeek: number | null = null;
                let canonicalEffectiveDate: Date | null = null;
                let effectiveAmount = 0;

                if (canonical) {
                    const breakdownMatch = findForecastBreakdownItem(canonical.id, 'outflows', 'bill');
                    
                    if (breakdownMatch) {
                        effectiveWeek = breakdownMatch.weekNumber;
                        effectiveAmount = breakdownMatch.item.amount;
                    } else {
                        effectiveAmount = resolveBillForecastAmount(canonical);
                    }

                    if (canonical.overrideDueDate) {
                        canonicalEffectiveDate = new Date(canonical.overrideDueDate);
                    } else if (canonical.dueDate) {
                        canonicalEffectiveDate = new Date(canonical.dueDate);
                    } else if (canonical.billDate) {
                        canonicalEffectiveDate = addDays(new Date(canonical.billDate), 30);
                    } else {
                        canonicalEffectiveDate = addDays(today, 7);
                    }
                }

                const originalDue = billRaw.dueDate ? new Date(billRaw.dueDate) : null;
                const dueDaysAgo = originalDue
                    ? Math.floor((today.getTime() - originalDue.getTime()) / 86400000)
                    : null;

                const moveCount = overridesByTarget.get(billRaw.id)?.filter(o => o.type === "set_bill_due_date" || o.type === "delay_due_date").length || 0;

                return {
                    id: billRaw.id,
                    vendorName: billRaw.vendorName,
                    billNo: billRaw.billNo,
                    amountOpen: effectiveAmount, // Canonical processed amount
                    originalAmount: billRaw.amountOpen,
                    billDate: billRaw.billDate?.toISOString() ?? null,
                    dueDate: billRaw.dueDate?.toISOString() ?? null,
                    daysPastDue: dueDaysAgo,
                    effectiveDate: canonicalEffectiveDate?.toISOString() ?? null,
                    effectiveWeek,
                    overrideDate: canonical?.overrideDueDate?.toISOString() ?? null,
                    criticality: canonical?.criticality ?? vp?.criticality ?? "normal",
                    moveCount,
                    isExcluded: !!isExcluded,
                    isFullyReconciled,
                    kind: "ap" as const,
                };
            }).filter(Boolean);

        const weeklyRecurringOutflows: number[] = new Array(13).fill(0);
        const weeklyRecurringInflows: number[] = new Array(13).fill(0);

        for (const w of forecastResult.weeks) {
            const outTotal = w.breakdown.outflows
                .filter((o: any) => o.sourceType === "recurring" || o.sourceType === "synthetic_payroll")
                .reduce((s: number, o: any) => s + o.amount, 0);
            if (w.weekNumber >= 1 && w.weekNumber <= 13) {
                weeklyRecurringOutflows[w.weekNumber - 1] = outTotal;
            }
            
            const inTotal = w.breakdown.inflows
                .filter((i: any) => i.sourceType === "recurring")
                .reduce((s: number, i: any) => s + i.amount, 0);
            if (w.weekNumber >= 1 && w.weekNumber <= 13) {
                weeklyRecurringInflows[w.weekNumber - 1] = inTotal;
            }
        }

        return NextResponse.json({
            companyId: cid,
            openingCash: input.adjustedOpeningCash,
            weeks,
            invoices: enrichedInvoices,
            bills: enrichedBills,
            weeklyRecurringOutflows: weeklyRecurringOutflows.map((total, i) => ({ weekNumber: i + 1, total })),
            weeklyRecurringInflows: weeklyRecurringInflows.map((total, i) => ({ weekNumber: i + 1, total })),
            forecast: {
                weeks: forecastResult.weeks.map(w => ({
                    weekNumber: w.weekNumber,
                    startCash: w.startCash,
                    endCashExpected: w.endCashExpected,
                    inflowsExpected: w.inflowsExpected,
                    outflowsExpected: w.outflowsExpected,
                    projectedInflow: Math.max(0, w.inflowsExpected -
                        w.breakdown.inflows
                            .filter((i: any) => i.sourceType === "invoice" || i.sourceType === "recurring")
                            .reduce((s: number, i: any) => s + i.amount, 0)
                    ),
                    projectedOutflow: Math.max(0, w.outflowsExpected -
                        w.breakdown.outflows
                            .filter((i: any) => i.sourceType === "bill" || i.sourceType === "recurring" || i.sourceType === "synthetic_payroll")
                            .reduce((s: number, i: any) => s + i.amount, 0)
                    ),
                    breakdown: w.breakdown,
                })),
                input: input,
                invoices: enrichedInvoices.filter((i: any) => !i.isExcluded),
                bills: enrichedBills.filter((b: any) => !b.isExcluded),
                recurring: recurring,
            },
            executionPlan: executionPlanData,
        });

    } catch (e: any) {
        console.error("CashFlow Grid GET Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
