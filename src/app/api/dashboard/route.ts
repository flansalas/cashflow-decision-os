// API: GET /api/dashboard?companyId=xxx
// Assembles all data for the Survival Dashboard

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { computeForecast, type ForecastInput, type ForecastInvoice, type ForecastBill, type ForecastRecurring } from "@/services/forecast";
import { detectAnomalies, computeConfidence, type QAInput } from "@/services/qa";
import { generateActions } from "@/services/actions";
import { computeBaseline, type BankTxForBaseline, type RecurringPatternForBaseline } from "@/services/baseline";
import { computeExpectedPaymentDate, parsePaymentCurve, getMonday, addDays } from "@/services/forecast";

export async function GET(req: NextRequest) {
    const companyId = req.nextUrl.searchParams.get("companyId");

    try {
        // If no companyId, try demo company
        let company;
        if (companyId) {
            company = await prisma.company.findUnique({ where: { id: companyId } });
        } else {
            company = await prisma.company.findFirst({ where: { isDemo: true } });
        }

        if (!company) {
            return NextResponse.json({ error: "Company not found" }, { status: 404 });
        }

        const cid = company.id;

        // ── Load all data in parallel ──────────────────────────────────
        const [
            cashSnapshot,
            cashAdjustments,
            invoicesRaw,
            billsRaw,
            customerProfiles,
            vendorProfiles,
            assumptionRaw,
            recurringPatternsRaw,
            overrides,
            bankTxs,
            companyNotes,
            cashFlowCategories,
            cashFlowEntries,
        ] = await Promise.all([
            prisma.cashSnapshot.findFirst({ where: { companyId: cid }, orderBy: { asOfDate: "desc" } }),
            prisma.cashAdjustment.findMany({ where: { companyId: cid } }),
            prisma.receivableInvoice.findMany({ where: { companyId: cid } }),
            prisma.payableBill.findMany({ where: { companyId: cid } }),
            prisma.customerProfile.findMany({ where: { companyId: cid } }),
            prisma.vendorProfile.findMany({ where: { companyId: cid } }),
            prisma.assumption.findFirst({ where: { companyId: cid } }),
            prisma.recurringPattern.findMany({ where: { companyId: cid } }),
            prisma.override.findMany({ where: { companyId: cid, status: "active" } }),
            // Load bank txs for baseline computation (last 12 weeks = ~84 days)
            prisma.bankTransaction.findMany({
                where: {
                    companyId: cid,
                    txDate: { gte: new Date(Date.now() - 84 * 86_400_000) },
                },
                select: { amount: true, txDate: true, description: true, direction: true },
            }),
            // CompanyNotes for flags (cash mismatch, etc.)
            prisma.companyNote.findMany({ where: { companyId: cid } }),
            prisma.cashFlowCategory.findMany({ where: { companyId: cid }, orderBy: [{ direction: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
            prisma.cashFlowEntry.findMany({ where: { companyId: cid }, include: { category: true } }),
        ]);

        if (!cashSnapshot) {
            return NextResponse.json({ error: "No cash snapshot found. Complete onboarding first." }, { status: 400 });
        }

        const assumptions = assumptionRaw ?? {
            bufferMin: 10000,
            fixedWeeklyOutflow: 0,
            payrollCadence: "biweekly",
            payrollAllInAmount: null,
            payrollNextDate: null,
            rentMonthlyAmount: null,
            rentDayOfMonth: null,
            paymentCurveJson: '{"current":0,"1-14":1,"15-30":2,"31-60":3,"61+":4}',
            highRiskAgingDays: 61,
            projectionSafetyMargin: 1.0,
        };

        // ── Compute baseline from bank transactions ────────────────────
        const bankTxsForBaseline: BankTxForBaseline[] = bankTxs.map(tx => ({
            // amount: positive for inflows (credit), negative for outflows (debit)
            // direction column is "inflow" | "outflow"; amount in DB is always positive
            amount: tx.direction === "inflow" ? tx.amount : -tx.amount,
            date: tx.txDate,
            merchantKey: tx.description ?? "",
        }));

        const patternsForBaseline: RecurringPatternForBaseline[] = recurringPatternsRaw.map(rp => ({
            merchantKey: rp.merchantKey ?? rp.displayName,
            direction: rp.direction,
            category: rp.category,
            isIncluded: rp.isIncluded,
        }));

        const baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, cashSnapshot.asOfDate);
        const hasBankBaseline = baseline.hasSufficientHistory;

        // ── Build customer/vendor lookup ────────────────────────────────
        const customerMap = new Map(customerProfiles.map(c => [c.customerName, c]));
        const vendorMap = new Map(vendorProfiles.map(v => [v.vendorName, v]));

        // ── Apply overrides to invoices ────────────────────────────────
        const overridesByTarget = new Map<string, typeof overrides>();
        for (const ov of overrides) {
            if (ov.targetId) {
                if (!overridesByTarget.has(ov.targetId)) overridesByTarget.set(ov.targetId, []);
                overridesByTarget.get(ov.targetId)!.push(ov);
            }
        }

        const invoices: ForecastInvoice[] = invoicesRaw.map(inv => {
            const cp = customerMap.get(inv.customerName);
            const ovs = overridesByTarget.get(inv.id) || [];

            let markedPaid = false;
            let overrideExpectedDate: Date | null = null;
            let overrideAmount: number | null = null;
            let partialPayment: number | null = null;

            for (const ov of ovs) {
                if (ov.type === "mark_paid") markedPaid = true;
                if (ov.type === "set_expected_payment_date" && ov.effectiveDate) overrideExpectedDate = ov.effectiveDate;
                if (ov.type === "adjust_amount" && ov.amount != null) overrideAmount = ov.amount;
                if (ov.type === "partial_payment" && ov.amount != null) partialPayment = ov.amount;
            }

            return {
                id: inv.id,
                customerName: inv.customerName,
                invoiceNo: inv.invoiceNo,
                amountOpen: inv.amountOpen,
                invoiceDate: inv.invoiceDate,
                dueDate: inv.dueDate,
                daysPastDue: inv.daysPastDue,
                status: inv.status,
                metaJson: inv.metaJson,
                typicalDelayWeeks: cp?.typicalDelayWeeks,
                riskTag: cp?.riskTag,
                overrideExpectedDate,
                overrideAmount,
                markedPaid,
                partialPayment,
            };
        });

        const bills: ForecastBill[] = billsRaw.map(bill => {
            const vp = vendorMap.get(bill.vendorName);
            const ovs = overridesByTarget.get(bill.id) || [];

            let markedPaid = false;
            let overrideDueDate: Date | null = null;
            let overrideAmount: number | null = null;

            for (const ov of ovs) {
                if (ov.type === "mark_paid") markedPaid = true;
                if (ov.type === "delay_due_date" && ov.effectiveDate) overrideDueDate = ov.effectiveDate;
                if (ov.type === "set_bill_due_date" && ov.effectiveDate) overrideDueDate = ov.effectiveDate;
                if (ov.type === "adjust_amount" && ov.amount != null) overrideAmount = ov.amount;
            }

            return {
                id: bill.id,
                vendorName: bill.vendorName,
                billNo: bill.billNo,
                amountOpen: bill.amountOpen,
                billDate: bill.billDate,
                dueDate: bill.dueDate,
                daysPastDue: bill.daysPastDue,
                status: bill.status,
                criticality: vp?.criticality,
                overrideDueDate,
                overrideAmount,
                markedPaid,
            };
        });

        // Build a map of patternId -> skipDates from active skip_recurring_occurrence overrides
        const skipDatesByPattern = new Map<string, string[]>();
        for (const ov of overrides) {
            if (ov.type === "skip_recurring_occurrence" && ov.targetId && ov.effectiveDate) {
                if (!skipDatesByPattern.has(ov.targetId)) skipDatesByPattern.set(ov.targetId, []);
                skipDatesByPattern.get(ov.targetId)!.push(ov.effectiveDate.toISOString().slice(0, 10));
            }
        }

        const recurring: ForecastRecurring[] = recurringPatternsRaw.map(rp => ({
            id: rp.id,
            direction: rp.direction as "inflow" | "outflow",
            displayName: rp.displayName,
            typicalAmount: rp.typicalAmount,
            amountStdDev: rp.amountStdDev,
            cadence: rp.cadence,
            nextExpectedDate: rp.nextExpectedDate,
            confidence: rp.confidence as "high" | "med" | "low",
            category: rp.category,
            isIncluded: rp.isIncluded,
            isCritical: rp.isCritical,
            skipDates: skipDatesByPattern.get(rp.id) ?? [],
        }));

        // Build one-time outflows from rescheduled recurring items
        const oneTimeOutflows = overrides
            .filter(ov => ov.type === "add_one_time_outflow" && ov.targetId && ov.effectiveDate && ov.amount != null && ov.metaJson?.startsWith("recurring:"))
            .map(ov => {
                const parts = ov.metaJson!.split("|from:");
                return {
                    patternId: ov.targetId!,
                    displayName: parts[0].replace("recurring:", ""),
                    amount: ov.amount!,
                    weekStart: ov.effectiveDate!,
                    sourceWeekStart: parts[1] || null,
                };
            });

        // ── Cash calculations ──────────────────────────────────────────
        const bankBalance = cashSnapshot.bankBalance;
        const adjustmentsTotal = cashAdjustments.reduce((sum, a) => sum + a.amount, 0);
        const adjustedOpeningCash = bankBalance + adjustmentsTotal;

        // ── Compute forecast ───────────────────────────────────────────
        const forecastInput: ForecastInput = {
            adjustedOpeningCash,
            bankBalance,
            adjustmentsTotal,
            asOfDate: cashSnapshot.asOfDate,
            invoices,
            bills,
            recurring,
            assumptions: {
                bufferMin: assumptions.bufferMin,
                fixedWeeklyOutflow: assumptions.fixedWeeklyOutflow,
                payrollCadence: assumptions.payrollCadence,
                payrollAllInAmount: assumptions.payrollAllInAmount,
                payrollNextDate: assumptions.payrollNextDate,
                rentMonthlyAmount: assumptions.rentMonthlyAmount,
                rentDayOfMonth: assumptions.rentDayOfMonth,
                paymentCurveJson: assumptions.paymentCurveJson,
                highRiskAgingDays: assumptions.highRiskAgingDays,
                projectionSafetyMargin: assumptions.projectionSafetyMargin,
            },
            hasBankBaseline,
            variableOutflowWeekly: baseline.variableOutflowWeekly,
            variableOutflowBand: baseline.variableOutflowBand,
            baselineInflowWeekly: baseline.variableInflowWeekly,
            baselineInflowBand: baseline.variableInflowBand,
            oneTimeOutflows,
            cashFlowEntries: cashFlowEntries.map((e: any) => ({
                categoryId: e.categoryId,
                categoryName: e.category.name,
                direction: e.category.direction as "inflow" | "outflow",
                label: e.label,
                amount: e.amount,
                weekNumber: e.weekNumber,
            })),
        };

        const forecast = computeForecast(forecastInput);

        // ── QA / Anomalies / Confidence ────────────────────────────────
        const payrollPattern = recurringPatternsRaw.find(
            rp => rp.category === "payroll" && rp.isIncluded
        );

        const qaInput: QAInput = {
            invoices: invoicesRaw.map(i => ({
                id: i.id,
                customerName: i.customerName,
                invoiceNo: i.invoiceNo,
                amountOpen: i.amountOpen,
                invoiceDate: i.invoiceDate,
                dueDate: i.dueDate,
                daysPastDue: i.daysPastDue,
            })),
            bills: billsRaw.map(b => ({
                id: b.id,
                vendorName: b.vendorName,
                billNo: b.billNo,
                amountOpen: b.amountOpen,
                billDate: b.billDate,
                dueDate: b.dueDate,
            })),
            assumptions: {
                payrollAllInAmount: assumptions.payrollAllInAmount,
                payrollNextDate: assumptions.payrollNextDate,
            },
            payrollPatternDetected: !!payrollPattern,
            payrollPatternConfidence: payrollPattern ? payrollPattern.confidence as "high" | "med" | "low" : null,
            hasBankData: bankTxs.length > 0,
            arRefreshDate: (() => {
                const note = companyNotes.find(n => n.noteText.startsWith("ar_refresh_at:"));
                if (!note) return null;
                const iso = note.noteText.slice("ar_refresh_at:".length);
                const d = new Date(iso);
                return isNaN(d.getTime()) ? null : d;
            })(),
            apRefreshDate: (() => {
                const note = companyNotes.find(n => n.noteText.startsWith("ap_refresh_at:"));
                if (!note) return null;
                const iso = note.noteText.slice("ap_refresh_at:".length);
                const d = new Date(iso);
                return isNaN(d.getTime()) ? null : d;
            })(),
            baseline,
            cashMismatchUnreconciled: companyNotes.some(n => n.noteText === "cash_mismatch_unreconciled"),
        };


        const anomalies = detectAnomalies(qaInput);
        const confidence = computeConfidence(qaInput, anomalies);

        // ── Actions ────────────────────────────────────────────────────
        const actions = generateActions({
            forecast,
            invoices,
            bills,
            bufferMin: assumptions.bufferMin,
        });

        // ── Payroll info for header ─────────────────────────────────────
        const payrollInfo = payrollPattern
            ? {
                nextDate: payrollPattern.nextExpectedDate,
                amount: payrollPattern.typicalAmount,
                confidence: payrollPattern.confidence,
                source: "detected" as const,
            }
            : assumptions.payrollAllInAmount
                ? {
                    nextDate: assumptions.payrollNextDate,
                    amount: assumptions.payrollAllInAmount,
                    confidence: "high" as const,
                    source: "manual" as const,
                }
                : null;

        // ── Backlog detection ──────────────────────────────────────────
        // «Past-due» = effective date is before this week's Monday AND no future override is active.
        // These items are silently dropped from the 13-week forecast, so we surface them here.
        const today = cashSnapshot.asOfDate;
        const currentMonday = getMonday(today);
        const paymentCurve = parsePaymentCurve(assumptions.paymentCurveJson);

        const overdueAP = billsRaw
            .filter(bill => {
                if (bill.status !== "open") return false;
                const ovs = overridesByTarget.get(bill.id) || [];
                const paid = ovs.some(o => o.type === "mark_paid");
                if (paid) return false;
                // If there is a future override, it's already scheduled — not a backlog item
                const futureOverride = ovs.find(o =>
                    (o.type === "delay_due_date" || o.type === "set_bill_due_date") &&
                    o.effectiveDate != null &&
                    new Date(o.effectiveDate) >= currentMonday
                );
                if (futureOverride) return false;
                // Determine effective due date
                const dueDate = bill.dueDate
                    ? new Date(bill.dueDate)
                    : bill.billDate
                        ? addDays(new Date(bill.billDate), 30)
                        : null;
                return dueDate != null && dueDate < currentMonday;
            })
            .map(bill => ({
                id: bill.id,
                vendorName: bill.vendorName,
                billNo: bill.billNo,
                amountOpen: bill.amountOpen,
                dueDate: bill.dueDate?.toISOString() ?? null,
                daysPastDue: bill.daysPastDue,
                kind: "ap" as const,
            }));

        const overdueAR = invoicesRaw
            .filter(inv => {
                if (inv.status !== "open") return false;
                const ovs = overridesByTarget.get(inv.id) || [];
                const paid = ovs.some(o => o.type === "mark_paid");
                if (paid) return false;
                // If there is a future override (explicit schedule), it's already in the grid
                const futureOverride = ovs.find(o =>
                    o.type === "set_expected_payment_date" &&
                    o.effectiveDate != null &&
                    new Date(o.effectiveDate) >= currentMonday
                );
                if (futureOverride) return false;
                // Compute expected payment date
                const forecastInv = {
                    id: inv.id,
                    customerName: inv.customerName,
                    invoiceNo: inv.invoiceNo,
                    amountOpen: inv.amountOpen,
                    invoiceDate: inv.invoiceDate,
                    dueDate: inv.dueDate,
                    daysPastDue: inv.daysPastDue,
                    status: inv.status,
                    metaJson: inv.metaJson,
                    typicalDelayWeeks: undefined,
                    riskTag: undefined,
                    overrideExpectedDate: null,
                    overrideAmount: null,
                    markedPaid: false,
                    partialPayment: null,
                };
                const { date: expectedDate } = computeExpectedPaymentDate(forecastInv, today, paymentCurve);
                return expectedDate < currentMonday;
            })
            .map(inv => ({
                id: inv.id,
                customerName: inv.customerName,
                invoiceNo: inv.invoiceNo,
                amountOpen: inv.amountOpen,
                dueDate: inv.dueDate?.toISOString() ?? null,
                daysPastDue: inv.daysPastDue,
                kind: "ar" as const,
            }));

        // ── Zone boundary explanation ───────────────────────────────────
        const committedWeeks = forecast.weeks.filter(w => w.zone === "committed").length;
        const patternWeeks = forecast.weeks.filter(w => w.zone === "pattern").length;
        let zoneBoundary: string;
        if (committedWeeks === 13) {
            zoneBoundary = "All 13 weeks have committed data";
        } else if (committedWeeks > 0 && patternWeeks > 0) {
            zoneBoundary = `${committedWeeks} committed week(s), ${patternWeeks} pattern week(s) from bank baseline, ${13 - committedWeeks - patternWeeks} uncertain`;
        } else if (committedWeeks > 0) {
            zoneBoundary = `${committedWeeks} committed week(s) with AR/AP data; remaining weeks uncertain`;
        } else if (hasBankBaseline) {
            zoneBoundary = `No committed AR/AP in forecast horizon; using bank patterns for Weeks 1–7, uncertain after`;
        } else {
            zoneBoundary = "No committed data and no bank baseline — all weeks forecasted from assumptions only";
        }

        // ── All recurring patterns (for Commitments Panel) ─────────────
        const allCommitments = recurringPatternsRaw.map(rp => ({
            id: rp.id,
            displayName: rp.displayName,
            category: rp.category,
            cadence: rp.cadence,
            nextExpectedDate: rp.nextExpectedDate,
            typicalAmount: rp.typicalAmount,
            amountStdDev: rp.amountStdDev,
            confidence: rp.confidence,
            isIncluded: rp.isIncluded,
            isCritical: rp.isCritical,
            direction: rp.direction,
        }));

        // Inject assumed payroll if no detected payroll pattern is included
        const hasPayrollPattern = recurringPatternsRaw.some(rp => rp.category === "payroll" && rp.isIncluded);
        if (!hasPayrollPattern && assumptions.payrollAllInAmount && assumptions.payrollNextDate) {
            allCommitments.push({
                id: "synthetic-payroll",
                displayName: "Payroll (Assumed)",
                category: "payroll",
                cadence: assumptions.payrollCadence || "biweekly",
                nextExpectedDate: assumptions.payrollNextDate,
                typicalAmount: assumptions.payrollAllInAmount,
                amountStdDev: 0,
                confidence: "high",
                isIncluded: true,
                isCritical: true,
                direction: "outflow",
            });
        }

        // ── Response ───────────────────────────────────────────────────
        return NextResponse.json({
            company: { id: company.id, name: company.name, isDemo: company.isDemo },
            cash: {
                bankBalance,
                adjustmentsTotal,
                adjustedOpeningCash,
                asOfDate: cashSnapshot.asOfDate,
                adjustments: cashAdjustments.map(a => ({
                    id: a.id, type: a.type, amount: a.amount, note: a.note,
                })),
            },
            assumptions: {
                bufferMin: assumptions.bufferMin,
                payrollCadence: assumptions.payrollCadence,
                payrollAllInAmount: assumptions.payrollAllInAmount,
                payrollNextDate: assumptions.payrollNextDate,
                fixedWeeklyOutflow: assumptions.fixedWeeklyOutflow,
                projectionSafetyMargin: assumptions.projectionSafetyMargin,
            },
            payroll: payrollInfo,
            payrollPromptNeeded: !payrollInfo,
            baseline: {
                computedFrom: baseline.computedFrom,
                hasSufficientHistory: baseline.hasSufficientHistory,
                weeksAnalyzed: baseline.weeksAnalyzed,
                note: baseline.note,
                variableOutflowWeekly: baseline.variableOutflowWeekly,
                variableInflowWeekly: baseline.variableInflowWeekly,
            },
            forecast,
            confidence,
            anomalies,
            anomalyCount: anomalies.length,
            actions: actions.slice(0, 5),
            commitments: allCommitments,
            commitmentsCount: allCommitments.filter(c => c.isIncluded && c.direction === "outflow").length,
            cashFlowCategories: cashFlowCategories.map((c: any) => ({
                id: c.id,
                name: c.name,
                direction: c.direction,
            })),
            zoneBoundary,
            lastUpdated: cashSnapshot.createdAt,
            onboardingCompleted: company.onboardingCompleted,
            backlog: {
                overdueAP,
                overdueAR,
                totalOverdueAP: overdueAP.reduce((s, b) => s + b.amountOpen, 0),
                totalOverdueAR: overdueAR.reduce((s, i) => s + i.amountOpen, 0),
            },
        });
    } catch (error) {
        console.error("Dashboard API error:", error);
        return NextResponse.json(
            { error: "Failed to compute dashboard data" },
            { status: 500 }
        );
    }
}
