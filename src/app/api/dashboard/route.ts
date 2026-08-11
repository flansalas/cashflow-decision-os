// API: GET /api/dashboard?companyId=xxx
// Assembles all data for the Survival Dashboard

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import prisma from "@/db/prisma";
import { computeForecast, type ForecastInput, type ForecastInvoice, type ForecastBill, type ForecastRecurring } from "@/services/forecast";
import { detectAnomalies, computeConfidence, computeDataQualityGate, type QAInput } from "@/services/qa";
import { generateActions } from "@/services/actions";
import { computeBaseline, type BankTxForBaseline, type RecurringPatternForBaseline, type BaselineResult } from "@/services/baseline";
import { computeVarianceMultipliers } from "@/services/variance";
import { computeCOGSCorrelation } from "@/services/cogs-correlation";
import { computeTypicalDelayWeeks } from "@/services/payment-memory";
import { computeExpectedPaymentDate, parsePaymentCurve, getMonday, addDays } from "@/services/forecast";
import { assembleForecastData } from "@/services/forecast-assembly";
import { resolveTenant } from "@/lib/tenant";
import type { BusinessCashState } from "@/domain/types";
import { buildManagerialVisibility, visibleBills, visibleInvoices } from "@/services/managerial-visibility";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const tenantId = await resolveTenant(req);
        let company = null;
        
        if (tenantId) {
            company = await prisma.company.findUnique({ where: { id: tenantId } });
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
            varianceLedger,
            customerPaymentObs,
            cachedBaseline,
        ] = await Promise.all([
            prisma.cashSnapshot.findFirst({ where: { companyId: cid }, orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }] }),
            prisma.cashAdjustment.findMany({ where: { companyId: cid } }),
            prisma.receivableInvoice.findMany({ where: { companyId: cid } }),
            prisma.payableBill.findMany({ where: { companyId: cid } }),
            prisma.customerProfile.findMany({ where: { companyId: cid } }),
            prisma.vendorProfile.findMany({ where: { companyId: cid } }),
            prisma.assumption.findFirst({ where: { companyId: cid } }),
            // Only active patterns — matches what baseline-snapshot.ts uses (status consistency fix)
            prisma.recurringPattern.findMany({ where: { companyId: cid, status: "active" } }),
            prisma.override.findMany({ where: { companyId: cid, status: "active" }, orderBy: { createdAt: "desc" } }),
            // Load ALL bank txs (no 365-day cap) — matches baseline-snapshot.ts behaviour (date filter consistency fix)
            prisma.bankTransaction.findMany({
                where: { companyId: cid },
                select: { amount: true, txDate: true, description: true, direction: true },
            }),
            // CompanyNotes for flags (cash mismatch, etc.)
            prisma.companyNote.findMany({ where: { companyId: cid } }),
            prisma.cashFlowCategory.findMany({ where: { companyId: cid }, orderBy: [{ direction: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
            prisma.cashFlowEntry.findMany({ where: { companyId: cid }, include: { category: true } }),
            prisma.baselineVarianceLedger.findMany({
                where: { companyId: cid },
                orderBy: { weekStart: "desc" },
                take: 8, // 8-week recency-weighted variance window
            }),
            prisma.customerPaymentObservation.findMany({
                where: { companyId: cid },
                select: { customerName: true, daysEarlyOrLate: true },
            }),
            prisma.baselineSnapshot.findUnique({
                where: { companyId: cid }
            }),
        ]);

        const [
            latestBankUpload,
            latestArUpload,
            latestApUpload,
        ] = await Promise.all([
            prisma.importBatch.findFirst({
                where: { companyId: cid, importType: "bank" },
                orderBy: { uploadedAt: "desc" },
            }),
            prisma.importBatch.findFirst({
                where: { companyId: cid, importType: "ar" },
                orderBy: { uploadedAt: "desc" },
            }),
            prisma.importBatch.findFirst({
                where: { companyId: cid, importType: "ap" },
                orderBy: { uploadedAt: "desc" },
            }),
        ]);

        const currentWeekStart = getMonday(cashSnapshot ? new Date(cashSnapshot.asOfDate) : new Date());

        // Legacy Migration: Auto-migrate CashFlowEntry to CashAdjustment
        if (cashFlowEntries.length > 0) {
            console.log(`Migrating ${cashFlowEntries.length} legacy CashFlowEntry items to CashAdjustment...`);
            for (const e of cashFlowEntries) {
                await prisma.cashAdjustment.create({
                    data: {
                        companyId: e.companyId,
                        type: e.category.name,
                        amount: e.category.direction === "outflow" ? -Math.abs(e.amount) : Math.abs(e.amount),
                        note: e.label || e.note || e.category.name,
                        effectiveDate: e.targetDate,
                        status: "active",
                        origin: "user",
                    }
                });
            }
            await prisma.cashFlowEntry.deleteMany({ where: { companyId: cid } });
            
            // Re-fetch cashAdjustments since we just modified them
            const updatedAdjustments = await prisma.cashAdjustment.findMany({ where: { companyId: cid } });
            cashAdjustments.length = 0;
            cashAdjustments.push(...updatedAdjustments);
            cashFlowEntries.length = 0; // Clear them out so they aren't double-counted
        }

        const activePlan = await prisma.executionPlan.findFirst({
            where: { companyId: cid, weekStart: currentWeekStart, status: "approved" },
            orderBy: { version: 'desc' }
        });

        let postApprovalChanges: any[] = [];
        let planForecast = null;

        if (activePlan) {
            try {
                if (activePlan.forecastStateJson) {
                    planForecast = JSON.parse(activePlan.forecastStateJson);
                }
            } catch (e) {
                console.error("Failed to parse forecastStateJson for active plan", e);
            }

            const rawChanges = await prisma.changeLog.findMany({
                where: { companyId: cid, timestamp: { gt: activePlan.createdAt } },
                orderBy: { timestamp: 'asc' }
            });
            postApprovalChanges = rawChanges.map(c => {
                let details = {};
                try {
                    details = JSON.parse(c.diffJson);
                } catch { }
                return {
                    id: c.id,
                    createdAt: c.timestamp.toISOString(),
                    details
                };
            });
        }

        if (!cashSnapshot) {
            return NextResponse.json({ error: "No cash snapshot found. Complete onboarding first." }, { status: 400 });
        }

        // Validate asOfDate
        if (isNaN(new Date(cashSnapshot.asOfDate).getTime())) {
            console.error("Dashboard API error: Invalid asOfDate in CashSnapshot", cashSnapshot.asOfDate);
            return NextResponse.json({ error: "Invalid snapshot date. Please re-run onboarding." }, { status: 400 });
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

        // ── Canonical Forecast Assembly ──────────────────────────────────
        // (Replacing duplicate dashboard assembly logic)
        const {
            input: forecastInput,
            forecastResult: forecast,
            organicForecast,
            baseline,
            invoices,
            bills
        } = await assembleForecastData(cid);

        const overridesByTarget = new Map<string, typeof overrides>();
        for (const ov of overrides) {
            if (ov.targetId) {
                if (!overridesByTarget.has(ov.targetId)) overridesByTarget.set(ov.targetId, []);
                overridesByTarget.get(ov.targetId)!.push(ov);
            }
        }
        const visibility = buildManagerialVisibility(
            overrides.filter(override => override.type === "exclude").map(override => ({
                targetId: override.targetId,
                targetType: override.targetType,
            })),
        );
        const managerialInvoicesRaw = visibleInvoices(invoicesRaw, visibility);
        const managerialBillsRaw = visibleBills(billsRaw, visibility);

        const hasBankBaseline = baseline.hasSufficientHistory;

        const multipliers = computeVarianceMultipliers(varianceLedger);
        let varianceMultiplier = multipliers.outflow;
        let varianceMultiplierIn = multipliers.inflow;

        const cogsCorrelation = computeCOGSCorrelation(baseline.weeklyBuckets);
        // DEBUG: log baseline stats so we can verify projection activation
        console.log("[baseline-debug]", {
            companyId: cid,
            bankTxCount: bankTxs.length,
            hasSufficientHistory: baseline.hasSufficientHistory,
            weeksAnalyzed: baseline.weeksAnalyzed,
            variableInflowWeekly: baseline.variableInflowWeekly,
            variableOutflowWeekly: baseline.variableOutflowWeekly,
            conservativeInflowWeekly: baseline.conservativeInflowWeekly,
            conservativeOutflowWeekly: baseline.conservativeOutflowWeekly,
            baselineConfidenceTier: baseline.baselineConfidenceTier,
            note: baseline.note,
        });



        // ── QA / Anomalies / Confidence ────────────────────────────────
        const payrollPattern = recurringPatternsRaw.find(
            rp => rp.category === "payroll" && rp.isIncluded
        );

        const qaInput: QAInput = {
            invoices: managerialInvoicesRaw.map(i => ({
                id: i.id,
                customerName: i.customerName,
                invoiceNo: i.invoiceNo,
                amountOpen: i.amountOpen,
                invoiceDate: i.invoiceDate,
                dueDate: i.dueDate,
                daysPastDue: i.daysPastDue,
            })),
            bills: managerialBillsRaw.map(b => ({
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
            baselineDependencyPct: (() => {
                let totalOrganic = 0;
                let totalBaseline = 0;
                for (const w of forecast.weeks) {
                    totalOrganic += w.inflowsExpected + w.outflowsExpected;
                    totalBaseline += w.breakdown.inflows.filter(b => b.sourceType === "baseline").reduce((sum, b) => sum + b.amount, 0);
                    totalBaseline += w.breakdown.outflows.filter(b => b.sourceType === "baseline").reduce((sum, b) => sum + b.amount, 0);
                }
                return totalOrganic > 0 ? totalBaseline / totalOrganic : 0;
            })(),
            cashMismatchUnreconciled: companyNotes.some(n => n.noteText === "cash_mismatch_unreconciled"),
        };


        const anomalies = detectAnomalies(qaInput);
        const confidence = computeConfidence(qaInput, anomalies);
        const dataQualityGate = computeDataQualityGate(qaInput);

        // ── Actions ────────────────────────────────────────────────────
        const actions = generateActions({
            forecast,
            invoices,
            bills,
            bufferMin: assumptions.bufferMin,
            rawForecastInput: forecastInput,
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
        const today = new Date(); // Use real server time for backlog, not potentially-stale snapshot date
        const currentMonday = getMonday(today);
        const paymentCurve = parsePaymentCurve(assumptions.paymentCurveJson);

        const overdueAP = managerialBillsRaw
            .filter(bill => {
                if (bill.status !== "open") return false;
                const ovs = overridesByTarget.get(bill.id) || [];
                const paid = ovs.some(o => o.type === "mark_paid");
                const excluded = ovs.some(o => o.type === "exclude");
                if (paid || excluded) return false;
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

        const overdueAR = managerialInvoicesRaw
            .filter(inv => {
                if (inv.status !== "open") return false;
                const ovs = overridesByTarget.get(inv.id) || [];
                const paid = ovs.some(o => o.type === "mark_paid");
                const excluded = ovs.some(o => o.type === "exclude");
                if (paid || excluded) return false;
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

        // ── Phase 1: Business Cash State ───────────────────────────────
        let businessCashState: BusinessCashState = "safe";
        if (forecast.weeks[0]?.endCashExpected < 0) {
            businessCashState = "exhausted";
        } else if (forecast.expectedRunOutWeek !== null) {
            businessCashState = "critical";
        } else if (forecast.constraintWeek !== null) {
            businessCashState = "threatened";
        }

        // ── Response ───────────────────────────────────────────────────
        return NextResponse.json({
            company: { id: company.id, name: company.name, isDemo: company.isDemo },
            businessCashState,
            cash: {
                bankBalance: forecastInput.bankBalance,
                adjustmentsTotal: forecastInput.adjustmentsTotal,
                adjustedOpeningCash: forecastInput.adjustedOpeningCash,
                asOfDate: cashSnapshot.asOfDate,
                adjustments: cashAdjustments.map(a => ({
                    id: a.id, type: a.type, amount: a.amount, note: a.note, description: a.description, date: a.effectiveDate, status: a.status, origin: a.origin
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
                aiReasoningLog: cachedBaseline?.aiReasoningLogJson ?? undefined,
                variableOutflowWeekly: baseline.variableOutflowWeekly,
                variableInflowWeekly: baseline.variableInflowWeekly,
            },
            organicForecast,
            forecast,
            confidence,
            dataQualityGate,
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
            macroMemory: {
                varianceMultiplier,
                averageVariancePct: (varianceMultiplier - 1) * 100,
                varianceMultiplierIn,
                averageVariancePctIn: (varianceMultiplierIn - 1) * 100,
                weeksTracked: varianceLedger.length,
            },
            zoneBoundary,
            lastUpdated: cashSnapshot.createdAt,
            freshness: {
                bankBalanceAsOf: cashSnapshot ? cashSnapshot.asOfDate.toISOString() : null,
                bankLastImportedAt: latestBankUpload ? latestBankUpload.uploadedAt.toISOString() : null,
                arLastImportedAt: latestArUpload ? latestArUpload.uploadedAt.toISOString() : null,
                apLastImportedAt: latestApUpload ? latestApUpload.uploadedAt.toISOString() : null,
                forecastCalculatedAt: new Date().toISOString(),
            },
            onboardingCompleted: company.onboardingCompleted,
            executionPlan: activePlan ? {
                id: activePlan.id,
                version: activePlan.version,
                createdAt: activePlan.createdAt.toISOString(),
                approvedBy: activePlan.approvedBy,
                planForecast
            } : null,
            postApprovalChanges,
            backlog: {
                overdueAP,
                overdueAR,
                totalOverdueAP: overdueAP.reduce((s, b) => s + b.amountOpen, 0),
                totalOverdueAR: overdueAR.reduce((s, i) => s + i.amountOpen, 0),
            },
        });
    } catch (error: any) {
        console.error("Dashboard API error:", error);
        return NextResponse.json(
            { error: "Failed to compute dashboard data: " + (error?.message || String(error)) },
            { status: 500 }
        );
    }
}
