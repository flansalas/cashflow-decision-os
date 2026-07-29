export const dynamic = 'force-dynamic';
// POST /api/cash-checkin
// Weekly roll ritual: saves a new CashSnapshot with today's balance.
// Does NOT delete old snapshots — history is preserved.
// The dashboard API uses findFirst(orderBy: asOfDate desc), so the new snapshot
// is automatically picked up and the forecast rolls forward.

import { NextRequest, NextResponse } from "next/server";
import { resolveTenant } from "@/lib/tenant";
import prisma from "@/db/prisma";
import { resolveForecastHashAfter } from "@/services/forecast-hash";
import { syncVarianceLedger } from "@/services/variance-sync";
import * as crypto from "crypto";

/**
 * Rolls a date forward by the given cadence until it is >= the asOfDate.
 */
function rollDate(startDate: Date, asOfDate: Date, cadence: string): Date {
    const d = new Date(startDate);
    // Safety break to prevent infinite loops (max 5 years forward)
    const maxDate = new Date(asOfDate);
    maxDate.setFullYear(maxDate.getFullYear() + 5);

    while (d < asOfDate && d < maxDate) {
        if (cadence === "weekly") d.setDate(d.getDate() + 7);
        else if (cadence === "biweekly") d.setDate(d.getDate() + 14);
        else if (cadence === "monthly") {
            const currentMonth = d.getMonth();
            d.setMonth(currentMonth + 1);
            // Handle month-end issues (e.g. Jan 31 -> Feb 28)
            if (d.getMonth() === (currentMonth + 2) % 12) {
                d.setDate(0);
            }
        }
        else break;
    }
    return d;
}

export async function POST(req: NextRequest) {
    const body = await req.json() as {
        companyId?: string;
        executionPlanId?: string;
        bankBalance: number;
        asOfDate?: string;
        adjustments?: Array<{ type: string; amount: number; note: string | null }>;
        priorWeekForecast?: {
            forecastVersionHash?: string;
            generatedAt?: string;
            weekStart: string;
            weekEnd: string;
            endCashExpected: number;
            inflowsExpected: number;
            outflowsExpected: number;
            breakdownJson?: string;
        };
    };

    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Missing or invalid company" }, { status: 401 });
    const companyId = tenantId;

    const { executionPlanId, bankBalance, asOfDate, adjustments = [], priorWeekForecast } = body;

    if (!companyId) {
        return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    }
    if (typeof bankBalance !== "number" || isNaN(bankBalance)) {
        return NextResponse.json({ error: "bankBalance must be a number" }, { status: 400 });
    }

    const snapshotDate = asOfDate ? new Date(asOfDate) : new Date();
    const isSaturday = snapshotDate.getUTCDay() === 6;
    let warningMsg: string | null = null;
    if (!isSaturday) {
        warningMsg = "Rolling the week requires your bank balance as of Saturday night. Using today's balance will skew your variance analysis.";
    }

    let bankDataMissing = false;
    let finalBreakdownJson = priorWeekForecast?.breakdownJson || null;

    try {
        // ── Core rollover transaction ─────────────────────────────────────
        // The entire rollover must fail if checkpoint preservation fails.
        const coreResult = await prisma.$transaction(async (tx) => {
            const snapshot = await tx.cashSnapshot.create({
                data: { companyId, bankBalance, asOfDate: snapshotDate },
            });

            // For v0.1, we replace all adjustments with the new list provided during the roll ritual
            await tx.cashAdjustment.deleteMany({ where: { companyId } });

            if (adjustments.length > 0) {
                await tx.cashAdjustment.createMany({
                    data: adjustments.map(a => ({
                        companyId,
                        type: a.type,
                        amount: a.amount,
                        note: a.note,
                        effectiveDate: snapshotDate
                    }))
                });
            }

            // ── Capture and Roll forward recurring patterns (including payroll) ─────────────
            const preRollMutationSnapshot = {
                recurringPatterns: [] as Array<{
                    id: string;
                    displayName: string;
                    previousNextExpectedDate: string;
                    newNextExpectedDate: string;
                    cadence: string;
                }>,
                assumptions: [] as Array<{
                    id: string;
                    previousPayrollNextDate: string;
                    newPayrollNextDate: string;
                }>
            };

            const patterns = await tx.recurringPattern.findMany({
                where: { companyId }
            });

            for (const p of patterns) {
                if (!p.nextExpectedDate) continue;
                const rolled = rollDate(p.nextExpectedDate, snapshotDate, p.cadence);
                if (rolled.getTime() !== p.nextExpectedDate.getTime()) {
                    preRollMutationSnapshot.recurringPatterns.push({
                        id: p.id,
                        displayName: p.displayName,
                        previousNextExpectedDate: p.nextExpectedDate.toISOString(),
                        newNextExpectedDate: rolled.toISOString(),
                        cadence: p.cadence
                    });

                    await tx.recurringPattern.update({
                        where: { id: p.id },
                        data: { nextExpectedDate: rolled }
                    });
                }
            }

            // ── Roll forward assumed (synthetic) payroll ───────────────────────
            const assumptions = await tx.assumption.findFirst({
                where: { companyId }
            });

            if (assumptions?.payrollNextDate) {
                const rolled = rollDate(assumptions.payrollNextDate, snapshotDate, assumptions.payrollCadence || "biweekly");
                if (rolled.getTime() !== assumptions.payrollNextDate.getTime()) {
                    preRollMutationSnapshot.assumptions.push({
                        id: assumptions.id,
                        previousPayrollNextDate: assumptions.payrollNextDate.toISOString(),
                        newPayrollNextDate: rolled.toISOString()
                    });

                    await tx.assumption.update({
                        where: { id: assumptions.id },
                        data: { payrollNextDate: rolled }
                    });
                }
            }

            // ── Roll forward What-If Scenarios ──────────────────────────────────
            // Scenarios are week-relative (W1-W13). When we roll, W2 becomes W1, etc.
            // 1. Remove scenarios from the week we just completed (Week 1)
            await tx.scenarioItem.deleteMany({
                where: { companyId, weekNumber: { lte: 1 } }
            });

            // 2. Decrement all future scenarios so they stay aligned with the calendar
            await tx.scenarioItem.updateMany({
                where: { companyId, weekNumber: { gt: 1 } },
                data: { weekNumber: { decrement: 1 } }
            });

            const changeLog = await tx.changeLog.create({
                data: {
                    companyId,
                    action: "UPDATE_BALANCE",
                    source: "user_ui",
                    inputText: `Updated bank balance to $${bankBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                    diffJson: JSON.stringify({
                        bankBalance,
                        asOfDate: snapshotDate.toISOString(),
                        adjustmentsCount: adjustments.length,
                        preRollMutationSnapshot
                    }),
                    forecastVersionHashAfter: "pending",
                }
            });


            let autoMissChangeLogId: string | null = null;
            // ── Mark ExecutionPlan as Reviewed inside the atomic transaction ───────
            if (executionPlanId) {
                await tx.executionPlan.update({
                    where: { id: executionPlanId, companyId },
                    data: {
                        status: "executed",
                        reviewedAt: new Date(),
                        actualEndingCash: bankBalance // Fixed semantic: exactly the entered actual balance
                    }
                });

                const plannedActions = await tx.actionItem.findMany({
                    where: {
                        companyId,
                        executionPlanId: executionPlanId,
                        status: "planned"
                    },
                    select: { id: true }
                });

                if (plannedActions.length > 0) {
                    await tx.actionItem.updateMany({
                        where: {
                            companyId,
                            executionPlanId: executionPlanId,
                            status: "planned"
                        },
                        data: {
                            status: "missed"
                        }
                    });

                    const autoMissLog = await tx.changeLog.create({
                        data: {
                            companyId,
                            source: "system",
                            action: "SYSTEM_AUTO_MISS_ACTIONS",
                            inputText: `Automatically marked ${plannedActions.length} planned action(s) as missed during week roll`,
                            diffJson: JSON.stringify({ affectedActionIds: plannedActions.map(a => a.id) }),
                            forecastVersionHashAfter: "pending"
                        }
                    });
                    autoMissChangeLogId = autoMissLog.id;
                }
            } else if (priorWeekForecast?.weekStart) {
                // Fallback: find the latest plan for the rolled week
                const plans = await tx.executionPlan.findMany({
                    where: { companyId, weekStart: new Date(priorWeekForecast.weekStart) },
                    orderBy: { version: 'desc' },
                    take: 1
                });
                if (plans.length > 0) {
                    await tx.executionPlan.update({
                        where: { id: plans[0].id },
                        data: {
                            status: "executed",
                            reviewedAt: new Date(),
                            actualEndingCash: bankBalance // Fixed semantic
                        }
                    });
                }
            }

        // ── Macro-Memory: Grade Baseline Variance ───────────────────────
        // Variance grading has been extracted to a background service that runs automatically
        // on bank uploads as well as here, comparing actuals against total projected variable spend.

        if (priorWeekForecast && bankDataMissing) {
            const unexplainedGap = bankBalance - priorWeekForecast.endCashExpected;
            try {
                const breakdown = JSON.parse(finalBreakdownJson || "{}");

                if (breakdown.inflows) {
                    breakdown.inflows = breakdown.inflows.map((item: any) => ({
                        ...item,
                        confidence: "low",
                        evidenceStatus: "unverified",
                        explanation: "Resolved, but no bank deposit found."
                    }));
                }
                if (breakdown.outflows) {
                    breakdown.outflows = breakdown.outflows.map((item: any) => ({
                        ...item,
                        confidence: "low",
                        evidenceStatus: "unverified",
                        explanation: "Resolved, but no bank withdrawal found."
                    }));
                }

                if (Math.abs(unexplainedGap) > 0.01) {
                    const lineItem = {
                        label: "Uncategorized Activity (Unverified)",
                        amount: Math.abs(unexplainedGap),
                        type: "manual",
                        sourceType: "manual",
                        confidence: "low",
                        evidenceStatus: "unverified",
                        explanation: "Unexplained variance to match user cash balance."
                    };
                    if (unexplainedGap > 0) {
                        breakdown.inflows = breakdown.inflows || [];
                        breakdown.inflows.push(lineItem);
                    } else {
                        breakdown.outflows = breakdown.outflows || [];
                        breakdown.outflows.push(lineItem);
                    }
                }
                finalBreakdownJson = JSON.stringify(breakdown);
            } catch (e) {
                console.warn("Failed to update breakdown JSON for unverified gap", e);
            }
        }

        // ── ForecastCheckpoint (BLOCKING) ─────────────────────
        // Checkpoint preservation is required if a prior forecast exists.
        let checkpoint = null;
        if (priorWeekForecast) {
            const hasValidWeekStart = priorWeekForecast.weekStart && !isNaN(new Date(priorWeekForecast.weekStart).getTime());
            const hasValidWeekEnd = priorWeekForecast.weekEnd && !isNaN(new Date(priorWeekForecast.weekEnd).getTime());
            const hasValidEndCash = typeof priorWeekForecast.endCashExpected === "number" && isFinite(priorWeekForecast.endCashExpected);
            const hasValidInflows = typeof priorWeekForecast.inflowsExpected === "number" && isFinite(priorWeekForecast.inflowsExpected);
            const hasValidOutflows = typeof priorWeekForecast.outflowsExpected === "number" && isFinite(priorWeekForecast.outflowsExpected);

            if (hasValidWeekStart && hasValidWeekEnd && hasValidEndCash && hasValidInflows && hasValidOutflows) {
                // Must succeed inside the transaction
                checkpoint = await tx.forecastCheckpoint.create({
                    data: {
                        companyId,
                        cashSnapshotId: snapshot.id, // coreResult isn't resolved yet
                        snapshotSource: (bankDataMissing || !isSaturday) ? "client_observed_unverified" : "client_observed_v1",
                        forecastVersionHash: priorWeekForecast.forecastVersionHash || null,
                        generatedAt: priorWeekForecast.generatedAt ? new Date(priorWeekForecast.generatedAt) : null,
                        weekStart: new Date(priorWeekForecast.weekStart),
                        weekEnd: new Date(priorWeekForecast.weekEnd),
                        endCashExpected: priorWeekForecast.endCashExpected,
                        inflowsExpected: priorWeekForecast.inflowsExpected,
                        outflowsExpected: priorWeekForecast.outflowsExpected,
                        breakdownJson: finalBreakdownJson,
                    }
                });

                // Slice 1: Snapshot generation
                if (finalBreakdownJson) {
                    const parsedBreakdown = JSON.parse(finalBreakdownJson);
                    // The UI passes the breakdown for the exact week being checked in
                    const targetWeek = parsedBreakdown;
                    
                    if (targetWeek) {
                        let snapshotInflowSum = 0;
                        let snapshotOutflowSum = 0;
                        const snapshotData = [];

                        for (const item of (targetWeek.inflows || [])) {
                            snapshotInflowSum += Math.round(item.amount * 100);
                            
                            const metadata = item.metadata || {};
                            const sourceStateJson = JSON.stringify(metadata);
                            const sourceStateHash = crypto.createHash("sha256").update(sourceStateJson).digest("hex");
                            
                            snapshotData.push({
                                forecastCheckpointId: checkpoint!.id,
                                targetWeekStart: checkpoint!.weekStart,
                                direction: "inflow",
                                componentCategory: item.section || "unknown",
                                sourceType: item.sourceType || "unknown",
                                sourceId: item.sourceId || null,
                                sourceAmountAtForecast: metadata.sourceAmountAtForecast ?? null,
                                sourceDateAtForecast: metadata.sourceDateAtForecast ? new Date(metadata.sourceDateAtForecast) : null,
                                sourceStatusAtForecast: metadata.sourceStatusAtForecast ?? null,
                                overrideId: metadata.overrideId ?? null,
                                projectedAmount: item.amount,
                                confidenceTier: item.confidence || "none",
                                sourceStateJson: sourceStateJson,
                                sourceStateHash: sourceStateHash,
                                isUserOverridden: item.type === "overridden"
                            });
                        }
                        
                        for (const item of (targetWeek.outflows || [])) {
                            snapshotOutflowSum += Math.round(item.amount * 100);
                            
                            const metadata = item.metadata || {};
                            const sourceStateJson = JSON.stringify(metadata);
                            const sourceStateHash = crypto.createHash("sha256").update(sourceStateJson).digest("hex");
                            
                            snapshotData.push({
                                forecastCheckpointId: checkpoint!.id,
                                targetWeekStart: checkpoint!.weekStart,
                                direction: "outflow",
                                componentCategory: item.section || "unknown",
                                sourceType: item.sourceType || "unknown",
                                sourceId: item.sourceId || null,
                                sourceAmountAtForecast: metadata.sourceAmountAtForecast ?? null,
                                sourceDateAtForecast: metadata.sourceDateAtForecast ? new Date(metadata.sourceDateAtForecast) : null,
                                sourceStatusAtForecast: metadata.sourceStatusAtForecast ?? null,
                                overrideId: metadata.overrideId ?? null,
                                projectedAmount: item.amount,
                                confidenceTier: item.confidence || "none",
                                sourceStateJson: sourceStateJson,
                                sourceStateHash: sourceStateHash,
                                isUserOverridden: item.type === "overridden"
                            });
                        }

                        const expectedInflowSumCents = Math.round(checkpoint!.inflowsExpected * 100);
                        const expectedOutflowSumCents = Math.round(checkpoint!.outflowsExpected * 100);

                        if (Math.abs(snapshotInflowSum - expectedInflowSumCents) > 5 || Math.abs(snapshotOutflowSum - expectedOutflowSumCents) > 5) {
                            console.warn(`Snapshot reconciliation discrepancy. Checkpoint: In=${expectedInflowSumCents}/Out=${expectedOutflowSumCents}. Snapshots: In=${snapshotInflowSum}/Out=${snapshotOutflowSum}. Continuing anyway.`);
                        }

                        if (snapshotData.length > 0) {
                            await tx.forecastComponentSnapshot.createMany({ data: snapshotData });
                        }
                    }
                }

            } else {
                throw new Error("Missing or invalid required forecast fields for checkpoint preservation.");
            }
        }

        return { snapshot, changeLogId: changeLog.id, checkpoint, autoMissChangeLogId };
        }); // End of transaction

        // Trigger variance sync after transaction completes
        try {
            await syncVarianceLedger(companyId);
        } catch (syncErr) {
            console.error("Failed to trigger variance sync in cash-checkin:", syncErr);
        }

        let checkpoint = coreResult.checkpoint;

        // ── Best-effort Learning Proposal Generation ──────────────────────
        try {
            await prisma.$transaction(async (tx) => {
                if (priorWeekForecast?.weekStart) {
                    const weekStart = new Date(priorWeekForecast.weekStart);

                    const actions = await tx.actionItem.findMany({
                        where: {
                            companyId,
                            status: "completed",
                            actualAmountImpact: { not: null },
                            executionPlan: { weekStart: weekStart }
                        }
                    });

                    let expectedTotal = 0;
                    let actualTotal = 0;
                    let actionIds: string[] = [];
                    for (const a of actions) {
                        expectedTotal += a.amountImpact;
                        actualTotal += a.actualAmountImpact!;
                        actionIds.push(a.id);
                    }

                    if (expectedTotal > 0 && actualTotal < expectedTotal) {
                        const variance = (expectedTotal - actualTotal) / expectedTotal;
                        if (variance >= 0.10) {
                            const assumption = await tx.assumption.findFirst({ where: { companyId } });
                            if (assumption) {
                                const currentSafetyMargin = assumption.projectionSafetyMargin;
                                const proposedSafetyMargin = parseFloat((currentSafetyMargin * 1.05).toFixed(2));
                                await tx.learningProposal.create({
                                    data: {
                                        companyId,
                                        type: "safety_margin_increase",
                                        proposedChangeJson: JSON.stringify({
                                            field: "projectionSafetyMargin",
                                            currentValue: currentSafetyMargin,
                                            proposedValue: proposedSafetyMargin
                                        }),
                                        rationale: `Completed actions for week underperformed expected cash effect by ${(variance * 100).toFixed(1)}%. Recommend increasing safety margin to protect runway.`,
                                        evidenceActionIds: JSON.stringify(actionIds)
                                    }
                                });
                            }
                        }
                    }
                }
            });
        } catch (proposalError) {
            console.error("Best-effort learning proposal generation failed:", proposalError);
        }

        // ── Post-roll hash generation (non-blocking) ──────────────────────
        let postRollHashWarning = null;
        const success = await resolveForecastHashAfter(companyId, coreResult.changeLogId);
        if (!success) {
            postRollHashWarning = "Failed to generate true post-roll hash; ChangeLog left as error.";
        }

        if (coreResult.autoMissChangeLogId) {
            const missSuccess = await resolveForecastHashAfter(companyId, coreResult.autoMissChangeLogId);
            if (!missSuccess) {
                postRollHashWarning = (postRollHashWarning ? postRollHashWarning + " " : "") + "Failed to generate hash for auto-missed actions.";
            }
        }

        return NextResponse.json({
            ok: true,
            snapshotId: coreResult.snapshot.id,
            asOfDate: coreResult.snapshot.asOfDate,
            checkpoint,
            warning: postRollHashWarning || warningMsg
        });

    } catch (error: any) {
        console.error("Cash check-in error:", error);
        return NextResponse.json({ error: error.message || "Failed to save balance and adjustments" }, { status: 500 });
    }
}

