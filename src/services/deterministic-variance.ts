import prisma from "@/db/prisma";
import type { DeterministicVarianceResult, DeterministicDriverGroup, DeterministicDriverItem } from "@/types/variance";
import type { ForecastComponentEvaluation, ForecastComponentEvaluationAttribution } from "@prisma/client";

export async function getDeterministicVarianceDrivers(
    checkpointId: string,
    companyId: string
): Promise<DeterministicVarianceResult | null> {
    // 1. Find active evaluation run
    const run = await prisma.forecastEvaluationRun.findFirst({
        where: { checkpointId, companyId, isActive: true },
        include: {
            components: {
                include: {
                    attributions: true,
                    snapshot: true // if we have a relation, let's try to fetch it
                }
            }
        }
    });

    if (!run) {
        return null; // Signals API to fallback to legacy
    }

    // 2. Load Checkpoint and Cash data
    const checkpoint = await prisma.forecastCheckpoint.findFirst({
        where: { id: checkpointId, companyId },
        include: { cashSnapshot: true }
    });

    if (!checkpoint) {
        throw new Error(`ForecastCheckpoint not found: ${checkpointId}`);
    }

    const adjustments = await prisma.cashAdjustment.findMany({
        where: { companyId },
        select: { amount: true },
    });

    // 3. Compute Actual Cash
    const actualBankBalance = checkpoint.cashSnapshot?.bankBalance || 0;
    const actualAdjustmentTotal = adjustments.reduce((sum, a) => sum + a.amount, 0);
    const actualAdjustedCash = actualBankBalance + actualAdjustmentTotal;
    const endCashExpected = checkpoint.endCashExpected;

    // 4. Calculate cash reconciliation difference
    // To strictly separate transaction variance from balance variance, we need the reconciliation difference.
    // actualEndingCash = startCash + actualInflows - actualOutflows + reconciliationDifference
    // But since we are looking at the week level, let's fetch bank transactions for the week to get actual inflows/outflows.
    const weekStart = checkpoint.weekStart;
    const weekEnd = checkpoint.weekEnd;

    // We need actual start cash. It's the previous checkpoint's actual bank balance, or a snapshot just before.
    const priorWeekStart = new Date(weekStart);
    priorWeekStart.setDate(priorWeekStart.getDate() - 7);
    const priorCheckpoint = await prisma.forecastCheckpoint.findFirst({
        where: { companyId, weekStart: priorWeekStart },
        orderBy: { generatedAt: 'desc' },
        include: { cashSnapshot: true }
    });

    let actualStartCash = priorCheckpoint?.cashSnapshot?.bankBalance;
    if (actualStartCash === undefined) {
        const fallbackSnapshot = await prisma.cashSnapshot.findFirst({
            where: { companyId, asOfDate: { lte: weekStart } },
            orderBy: { asOfDate: 'desc' }
        });
        actualStartCash = fallbackSnapshot?.bankBalance ?? 0;
    }

    const txs = await prisma.bankTransaction.groupBy({
        by: ['direction'],
        where: {
            companyId,
            txDate: { gte: weekStart, lt: weekEnd }
        },
        _sum: { amount: true }
    });

    const actualInflows = txs.find(t => t.direction === 'inflow')?._sum.amount ?? 0;
    const actualOutflows = txs.find(t => t.direction === 'outflow')?._sum.amount ?? 0;

    // reconciliationDifference = actualEndingCash - (actualStartCash + actualInflows + actualOutflows)
    // (Note: actualOutflows is natively negative, so adding it decreases the balance)
    const cashReconciliationDifference = actualBankBalance - (actualStartCash + actualInflows + actualOutflows);

    // 5. Group driver items
    let transactionBasedForecastVariance = 0;
    let deterministicUnresolvedVariance = 0;
    let deterministicExplainedVariance = 0;

    const groupMap: Record<string, DeterministicDriverItem[]> = {
        "Timing Shifts": [],
        "Amount Differences": [],
        "Missed Forecast Items": [],
        "Unexpected Actual Cash": [],
        "Unresolved Actual Cash": [],
        "Matched Items": []
    };

    const statusToCategory: Record<string, string> = {
        "timing_shift": "Timing Shifts",
        "partial": "Amount Differences",
        "missed": "Missed Forecast Items",
        "unexpected_actual": "Unexpected Actual Cash",
        "unresolved_actual": "Unresolved Actual Cash",
        "matched": "Matched Items"
    };

    for (const comp of (run.components as any[])) {
        transactionBasedForecastVariance += comp.varianceAmount;
        
        if (comp.status === "unresolved_actual") {
            deterministicUnresolvedVariance += comp.varianceAmount;
        } else {
            deterministicExplainedVariance += comp.varianceAmount;
        }

        const category = statusToCategory[comp.status] || "Matched Items";
        
        let displayLabel = comp.sourceId ? `${comp.sourceType} ${comp.sourceId}` : comp.sourceType;
        if (comp.status === "unresolved_actual") {
            displayLabel = "Unmatched Cash Movement";
        } else if (comp.sourceType === "receivable_invoice") {
            displayLabel = `Invoice ${comp.sourceId}`;
        } else if (comp.sourceType === "payable_bill") {
            displayLabel = `Bill ${comp.sourceId}`;
        }

        const expectedDateIso = comp.snapshot?.sourceDateAtForecast?.toISOString() || weekStart.toISOString();
        
        const item: DeterministicDriverItem = {
            id: comp.id,
            status: comp.status,
            sourceType: comp.sourceType,
            sourceId: comp.sourceId,
            displayLabel,
            expectedAmount: comp.expectedAmount,
            actualAmount: comp.actualAmount,
            varianceImpact: comp.varianceAmount,
            expectedDate: expectedDateIso,
            evidenceRole: comp.attributions.length > 0 ? comp.attributions[0].evidenceRole : "current_week_actual",
            linkedAttributions: comp.attributions.map((attr: any) => ({
                bankTransactionId: attr.bankTransactionId,
                amountApplied: attr.amountApplied,
                confidenceTier: attr.confidenceTier,
                txDate: attr.txDate.toISOString(),
                description: attr.description || ""
            }))
        };

        if (comp.daysShifted !== null && comp.shiftDirection !== null) {
            item.timing = {
                daysShifted: comp.daysShifted,
                shiftDirection: comp.shiftDirection as "early" | "late",
                actualDate: comp.actualDate ? comp.actualDate.toISOString() : expectedDateIso
            };
        }

        groupMap[category].push(item);
    }

    // Sort items within each category
    for (const category of Object.keys(groupMap)) {
        groupMap[category].sort((a, b) => {
            // Sort by absolute impact descending
            const absA = Math.abs(a.varianceImpact);
            const absB = Math.abs(b.varianceImpact);
            if (absA !== absB) return absB - absA;
            // Then expected amount descending
            if (a.expectedAmount !== b.expectedAmount) return b.expectedAmount - a.expectedAmount;
            // Then sourceId (alphabetical)
            if (a.sourceId && b.sourceId) return a.sourceId.localeCompare(b.sourceId);
            return 0;
        });
    }

    const groups: DeterministicDriverGroup[] = [
        { category: "Timing Shifts", items: groupMap["Timing Shifts"] },
        { category: "Amount Differences", items: groupMap["Amount Differences"] },
        { category: "Missed Forecast Items", items: groupMap["Missed Forecast Items"] },
        { category: "Unexpected Actual Cash", items: groupMap["Unexpected Actual Cash"] },
        { category: "Unresolved Actual Cash", items: groupMap["Unresolved Actual Cash"] },
        { category: "Matched Items", items: groupMap["Matched Items"] }
    ].filter(g => g.items.length > 0);

    const balanceBasedEndingCashVariance = transactionBasedForecastVariance + cashReconciliationDifference;

    // Strict mathematical invariant check
    const sumOfImpacts = (run.components as any[]).reduce((acc, curr) => acc + curr.varianceAmount, 0);
    // Tolerate tiny floating point rounding issues
    if (Math.abs(sumOfImpacts - transactionBasedForecastVariance) > 0.01) {
        throw new Error(`System reconciliation error: driver impacts sum (${sumOfImpacts}) != transaction-based variance (${transactionBasedForecastVariance})`);
    }

    return {
        isDeterministic: true,
        checkpointId,
        companyId,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
        evaluationVersion: run.version,
        totals: {
            balanceBasedEndingCashVariance,
            transactionBasedForecastVariance,
            cashReconciliationDifference,
            deterministicExplainedVariance,
            deterministicUnresolvedVariance
        },
        cashReconciliation: {
            startCash: actualStartCash,
            inflows: actualInflows,
            outflows: actualOutflows,
            expectedEndingCash: endCashExpected,
            actualEndingCash: actualBankBalance,
            reconciliationDifference: cashReconciliationDifference,
            adjustments: actualAdjustmentTotal,
            adjustedCash: actualAdjustedCash
        },
        groups
    };
}
