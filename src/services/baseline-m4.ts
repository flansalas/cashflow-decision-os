// services/baseline.ts – Compute variable inflow/outflow baselines from bank transactions
// Pure logic. No React, no DB imports.
// Strategy A: computes real values from last 8–12 weeks of bank tx,
// excluding detected recurring patterns (payroll, rent, etc.)

export interface BankTxForBaseline {
    amount: number;       // positive = inflow, negative = outflow (caller normalizes sign)
    date: Date;
    merchantKey: string;  // typically the description field from bank tx
}

import { normalizeDescription, categorize, isRecurringIdentityMatch } from "./detectPatterns";
import { computeACF, detectDominantCadence } from "./acf";
import { prepareBaselineTransactions } from "./baseline-shared";

export interface RecurringPatternForBaseline {
    merchantKey: string;
    direction: string;
    category: string;
    isIncluded: boolean;
    typicalAmount: number;
    amountStdDev: number;
    cadence?: string;
    minAmount?: number;
    maxAmount?: number;
    displayName?: string;
}

export type BaselineConfidenceTier = "high" | "med" | "low" | "none";

export interface BaselineResult {
    variableOutflowWeekly: number;
    variableInflowWeekly: number;
    variableOutflowBand: number;   // fractional stddev / mean
    variableInflowBand: number;
    conservativeInflowWeekly: number;   // 25th percentile of weekly inflows
    conservativeOutflowWeekly: number;  // 25th percentile of weekly outflows (lower = optimistic for outflows)
    weeklyBuckets: Array<{ inflow: number; outflow: number }>; // raw weekly data for COGS correlation
    weeksAnalyzed: number;
    hasSufficientHistory: boolean; // true if >= 2 complete weeks of data
    baselineConfidenceTier: BaselineConfidenceTier; // "high" 6+ wks | "med" 3-5 | "low" 1-2 | "none" 0
    computedFrom: "bank_tx" | "placeholder";
    note: string;
    methodNote: string;
    inflowCadence?: number;
    outflowCadence?: number;
}

export interface BaselineAssumptions {
    payrollAllInAmount: number | null;
    payrollNextDate: Date | null;
    payrollCadence: string;
    rentMonthlyAmount: number | null;
    rentDayOfMonth: number | null;
}

// Minimum weeks required to enable gap-fill projections (12 weeks = 3 months for reliable 52w model)
export const MIN_WEEKS_REQUIRED = 12;
// Analyze exactly 26 weeks for M4 Challenger
const WEEKS_TO_ANALYZE = 26;

function toBaselineTier(activeWeekCount: number): BaselineConfidenceTier {
    if (activeWeekCount >= 6) return "high";
    if (activeWeekCount >= 3) return "med";
    if (activeWeekCount >= 1) return "low";
    return "none";
}

export function computeM4Baseline(
    txs: BankTxForBaseline[],
    patterns: RecurringPatternForBaseline[],
    asOfDate: Date,
    assumptions?: BaselineAssumptions,
): BaselineResult {
    if (txs.length === 0) {
        return placeholderBaseline("No bank transactions available");
    }

    const { weekBuckets, dailyInflowSeries, dailyOutflowSeries } = prepareBaselineTransactions(txs, patterns, asOfDate, assumptions, WEEKS_TO_ANALYZE);

    const excludedPatterns = patterns.filter(p => !p.isIncluded);

    // Find weeks with at least some activity
    const activeWeeks = weekBuckets.filter(b => b.inflow > 0 || b.outflow > 0);

    if (activeWeeks.length < MIN_WEEKS_REQUIRED) {
        // SPAN-BASED FALLBACK: bucket-based approach fails when all transactions land
        // in the same calendar week (e.g. a bank statement uploaded as a single batch).
        // Instead, measure the window from oldest transaction → asOfDate and compute
        // a weekly average from the totals over that span.
        const txDates = txs.map(t => t.date.getTime());
        const oldestTxDate = Math.min(...txDates);
        const daySpan = (asOfDate.getTime() - oldestTxDate) / 86_400_000;

        if (daySpan >= 1) {
            const weeksSpan = Math.max(1, daySpan / 7);
            const totalInflow = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
            const totalOutflow = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

            // Subtract estimated recurring contribution over this span
            let recurringInflowTotal = 0;
            let recurringOutflowTotal = 0;
            for (const p of excludedPatterns) {
                const occurrences = Math.max(1, Math.round(weeksSpan));
                if (p.direction === "inflow") recurringInflowTotal += (p.minAmount ?? p.typicalAmount) * occurrences;
                else recurringOutflowTotal += (p.minAmount ?? p.typicalAmount) * occurrences;
            }

            const variableInflow = Math.max(0, totalInflow - recurringInflowTotal);
            const variableOutflow = Math.max(0, totalOutflow - recurringOutflowTotal);
            const weeklyInflow = variableInflow / weeksSpan;
            const weeklyOutflow = variableOutflow / weeksSpan;
            const tier = toBaselineTier(Math.max(1, Math.round(weeksSpan)));

            return {
                variableOutflowWeekly: Math.round(weeklyOutflow * 100) / 100,
                variableInflowWeekly: Math.round(weeklyInflow * 100) / 100,
                variableOutflowBand: 0.4,
                variableInflowBand: 0.45,
                conservativeInflowWeekly: Math.round(weeklyInflow * 0.7 * 100) / 100,
                conservativeOutflowWeekly: Math.round(weeklyOutflow * 1.3 * 100) / 100,
                weeklyBuckets: weekBuckets,
                weeksAnalyzed: Math.round(weeksSpan),
                hasSufficientHistory: true,
                baselineConfidenceTier: tier,
                computedFrom: "bank_tx",
                note: `Span-based: ${Math.round(daySpan)}d window → $${Math.round(weeklyInflow).toLocaleString()}/wk inflow (${tier} confidence). Upload more history for higher accuracy.`,
                methodNote: "Span-based average (insufficient weeks for CV-adaptive)",
            };
        }

        return placeholderBaseline(
            `Only ${activeWeeks.length} active weeks found in 52-week history`
        );
    }

    const inflowValues: number[] = [];
    const outflowValues: number[] = [];

    const firstActiveIdx = weekBuckets.findIndex(b => b.inflow > 0 || b.outflow > 0);
    const lastActiveIdx = weekBuckets.length - 1 - [...weekBuckets].reverse().findIndex(b => b.inflow > 0 || b.outflow > 0);

    for (let i = 0; i < WEEKS_TO_ANALYZE; i++) {
        // Skip unpopulated weeks outside the active span of uploaded history
        if (firstActiveIdx !== -1 && (i < firstActiveIdx || i > lastActiveIdx)) continue;
        const b = weekBuckets[i];
        inflowValues.push(b.inflow);
        outflowValues.push(b.outflow);
    }

    // M4: Simple unweighted 26-week mean (no CV switching, no trimming)
    const variableInflowWeekly = mean(inflowValues);
    const variableOutflowWeekly = mean(outflowValues);
    
    // M4: Use basic stddev bands for conservatism
    const inflowStd = stddev(inflowValues);
    const outflowStd = stddev(outflowValues);

    const conservativeInflowWeekly = Math.max(0, variableInflowWeekly - inflowStd * 0.5);
    const conservativeOutflowWeekly = variableOutflowWeekly + outflowStd * 0.5;

    const variableInflowBand = variableInflowWeekly > 0
        ? Math.min(0.6, inflowStd / variableInflowWeekly)
        : 0.3;

    const variableOutflowBand = variableOutflowWeekly > 0
        ? Math.min(0.4, outflowStd / variableOutflowWeekly)
        : 0.2;

    const methodNoteStr = "M4 26-Week Unweighted Mean";

    // Detect Cadence for residual inflows
    let inflowCadence: number | undefined = undefined;
    let outflowCadence: number | undefined = undefined;

    if (activeWeeks.length >= 4) {
        const acfInflow = computeACF(dailyInflowSeries, 40);
        const dominantInflowLag = detectDominantCadence(acfInflow, 0.35);
        if (dominantInflowLag && dominantInflowLag >= 7) {
            inflowCadence = dominantInflowLag;
        }

        const acfOutflow = computeACF(dailyOutflowSeries, 40);
        const dominantOutflowLag = detectDominantCadence(acfOutflow, 0.35);
        if (dominantOutflowLag && dominantOutflowLag >= 7) {
            outflowCadence = dominantOutflowLag;
        }
    }

    return {
        variableOutflowWeekly: Math.round(variableOutflowWeekly * 100) / 100,
        variableInflowWeekly: Math.round(variableInflowWeekly * 100) / 100,
        variableOutflowBand: Math.round(variableOutflowBand * 100) / 100,
        variableInflowBand: Math.round(variableInflowBand * 100) / 100,
        conservativeInflowWeekly: Math.round(conservativeInflowWeekly * 100) / 100,
        conservativeOutflowWeekly: Math.round(conservativeOutflowWeekly * 100) / 100,
        weeklyBuckets: weekBuckets,
        weeksAnalyzed: activeWeeks.length,
        hasSufficientHistory: true,
        baselineConfidenceTier: toBaselineTier(activeWeeks.length),
        computedFrom: "bank_tx",
        note: `Computed M4 Challenger Baseline from ${activeWeeks.length} weeks of bank tx`,
        methodNote: methodNoteStr,
        inflowCadence,
        outflowCadence,
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function placeholderBaseline(reason: string): BaselineResult {
    return {
        variableOutflowWeekly: 0,
        variableInflowWeekly: 0,
        variableOutflowBand: 0.2,
        variableInflowBand: 0.3,
        conservativeInflowWeekly: 0,
        conservativeOutflowWeekly: 0,
        weeklyBuckets: [],
        weeksAnalyzed: 0,
        hasSufficientHistory: false,
        baselineConfidenceTier: "none",
        computedFrom: "placeholder",
        note: `Baseline uses placeholder defaults — ${reason}`,
        methodNote: "Placeholder",
    };
}


function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[]): number {
    if (values.length < 2) return 0;
    const m = mean(values);
    const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a,b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function trimmedValues(values: number[], trimPct: number = 0.1): number[] {
    if (values.length < 5) return values; // too few to trim
    const sorted = [...values].sort((a, b) => a - b);
    const trimCount = Math.max(1, Math.floor(sorted.length * trimPct));
    return sorted.slice(trimCount, sorted.length - trimCount);
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(idx);
    const upper = Math.ceil(idx);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

function clipOutliers(values: number[]): number[] {
    if (values.length === 0) return [];
    const med = median(values);
    if (med === 0) return values;
    const cap = med * 2.5; 
    return values.map(v => v > cap ? cap : v);
}

function computeWeightedMeanAndStdDev(values: number[], weights: number[]): { mean: number, stddev: number } {
    const sumW = weights.reduce((a,b) => a+b, 0);
    if (sumW === 0) return { mean: 0, stddev: 0 };
    let mean = 0;
    for(let i=0; i<values.length; i++) mean += values[i]*weights[i];
    mean /= sumW;
    
    let variance = 0;
    for(let i=0; i<values.length; i++) variance += weights[i]*Math.pow(values[i] - mean, 2);
    // using basic weighted variance
    variance /= sumW; 
    
    // Fallback: if capped values still yield extremely high standard deviation, cap variance logically.
    return { mean, stddev: Math.sqrt(variance) };
}
