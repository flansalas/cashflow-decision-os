export interface DeterministicDriverItem {
    id: string;
    status: string;
    sourceType: string;
    sourceId: string | null;
    displayLabel: string;
    expectedAmount: number;
    actualAmount: number;
    varianceImpact: number;
    expectedDate: string;
    timing?: {
        daysShifted: number;
        shiftDirection: "early" | "late";
        actualDate: string;
    };
    evidenceRole: string;
    linkedAttributions: {
        bankTransactionId: string;
        amountApplied: number;
        confidenceTier: string;
        txDate: string;
        description: string;
    }[];
}

export interface DeterministicDriverGroup {
    category: string;
    items: DeterministicDriverItem[];
}

export interface DeterministicVarianceResult {
    isDeterministic: true;
    checkpointId: string;
    companyId: string;
    weekStart: string;
    weekEnd: string;
    evaluationVersion: number;
    totals: {
        balanceBasedEndingCashVariance: number;
        transactionBasedForecastVariance: number;
        cashReconciliationDifference: number;
        deterministicExplainedVariance: number;
        deterministicUnresolvedVariance: number;
    };
    cashReconciliation: {
        startCash: number;
        inflows: number;
        outflows: number;
        expectedEndingCash: number;
        actualEndingCash: number;
        reconciliationDifference: number;
        adjustments: number;
        adjustedCash: number;
    };
    groups: DeterministicDriverGroup[];
}

import type { VarianceDriverResult as LegacyVarianceDriverResult } from "@/services/variance-drivers";

export type LegacyVarianceResult = LegacyVarianceDriverResult & {
    isDeterministic: false;
};

export type UnifiedVarianceResult = DeterministicVarianceResult | LegacyVarianceResult;
