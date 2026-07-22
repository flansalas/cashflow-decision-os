// services/baseline.ts – Compute variable inflow/outflow baselines from bank transactions
// Pure logic. No React, no DB imports.
// Strategy A: computes real values from last 8–12 weeks of bank tx,
// excluding detected recurring patterns (payroll, rent, etc.)

export interface BankTxForBaseline {
    amount: number;       // positive = inflow, negative = outflow (caller normalizes sign)
    date: Date;
    merchantKey: string;  // typically the description field from bank tx
}

import { normalizeDescription, categorize } from "./detectPatterns";
import { computeACF, detectDominantCadence } from "./acf";

export interface RecurringPatternForBaseline {
    merchantKey: string;
    direction: string;
    category: string;
    isIncluded: boolean;
    typicalAmount: number;
    amountStdDev: number;
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
// Analyze up to 52 weeks (1 year) of history — recency weighting handles the bias
const WEEKS_TO_ANALYZE = 52;

function toBaselineTier(activeWeekCount: number): BaselineConfidenceTier {
    if (activeWeekCount >= 6) return "high";
    if (activeWeekCount >= 3) return "med";
    if (activeWeekCount >= 1) return "low";
    return "none";
}

export function computeBaseline(
    txs: BankTxForBaseline[],
    patterns: RecurringPatternForBaseline[],
    asOfDate: Date,
    assumptions?: BaselineAssumptions,
): BaselineResult {
    if (txs.length === 0) {
        return placeholderBaseline("No bank transactions available");
    }

    // Build set of recurring merchantKeys to exclude
    // Using normalizeDescription for identity and allowing bounded checks
    const excludedPatterns = patterns
        .filter(p => p.isIncluded)
        .map(p => {
            const isVolatile = ["utilities", "fuel", "taxes", "card_payment", "payroll"].includes(p.category);
            const tolerance = isVolatile ? 0.5 : 0.2;
            return {
                key: normalizeDescription(p.merchantKey || ""),
                direction: p.direction,
                minAmount: p.typicalAmount - Math.max(p.typicalAmount * tolerance, p.amountStdDev * 2),
                maxAmount: p.typicalAmount + Math.max(p.typicalAmount * tolerance, p.amountStdDev * 2)
            };
        });

    // Compute week boundaries: last WEEKS_TO_ANALYZE complete weeks before asOfDate
    const weekBuckets: { inflow: number; outflow: number }[] = [];
    const weekStart0 = mondayBefore(asOfDate, WEEKS_TO_ANALYZE);
    const dailyInflowSeries = new Array(WEEKS_TO_ANALYZE * 7).fill(0);
    const dailyOutflowSeries = new Array(WEEKS_TO_ANALYZE * 7).fill(0);

    for (let i = 0; i < WEEKS_TO_ANALYZE; i++) {
        const wStart = addWeeks(weekStart0, i);
        const wEnd = addDays(wStart, 6);

        let inflowSum = 0;
        let outflowSum = 0;

        for (const tx of txs) {
            // Skip invalid dates to prevent them from matching all buckets
            if (!tx.date || isNaN(tx.date.getTime())) continue;
            if (tx.date < wStart || tx.date > wEnd) continue;
            // Exclude known recurring patterns
            const normalizedTxKey = normalizeDescription(tx.merchantKey || "");
            const txDirection = tx.amount >= 0 ? "inflow" : "outflow";
            const absAmount = Math.abs(tx.amount);
            const txCategory = categorize(tx.merchantKey || "");

            let matchesAssumption = false;
            if (assumptions) {
                if (
                    assumptions.payrollAllInAmount &&
                    assumptions.payrollNextDate &&
                    txCategory === "payroll" &&
                    txDirection === "outflow" &&
                    absAmount >= assumptions.payrollAllInAmount * 0.8 &&
                    absAmount <= assumptions.payrollAllInAmount * 1.2
                ) {
                    const daysDiff = Math.abs(daysBetween(tx.date, assumptions.payrollNextDate));
                    const cadenceDays = assumptions.payrollCadence === "weekly" ? 7 : assumptions.payrollCadence === "biweekly" ? 14 : 30;
                    const remainder = daysDiff % cadenceDays;
                    const toleranceDays = cadenceDays === 7 ? 1 : 3;
                    if (remainder <= toleranceDays || remainder >= cadenceDays - toleranceDays) {
                        matchesAssumption = true;
                    }
                }

                if (
                    !matchesAssumption &&
                    assumptions.rentMonthlyAmount &&
                    assumptions.rentDayOfMonth &&
                    txCategory === "rent" &&
                    txDirection === "outflow" &&
                    absAmount >= assumptions.rentMonthlyAmount * 0.8 &&
                    absAmount <= assumptions.rentMonthlyAmount * 1.2
                ) {
                    const txDay = tx.date.getDate();
                    const rentDay = assumptions.rentDayOfMonth;
                    const diff = Math.min(
                        Math.abs(txDay - rentDay),
                        Math.abs(txDay + 30 - rentDay),
                        Math.abs(rentDay + 30 - txDay)
                    );
                    if (diff <= 3) {
                        matchesAssumption = true;
                    }
                }
            }

            if (matchesAssumption) continue;

            const isExcluded = excludedPatterns.some(p => 
                p.key === normalizedTxKey &&
                p.direction === txDirection &&
                absAmount >= p.minAmount && 
                absAmount <= p.maxAmount
            );
            if (isExcluded) continue;

            const dayIndex = daysBetween(weekStart0, tx.date);
            if (tx.amount > 0) {
                inflowSum += tx.amount;
                if (dayIndex >= 0 && dayIndex < dailyInflowSeries.length) dailyInflowSeries[dayIndex] += tx.amount;
            } else {
                outflowSum += Math.abs(tx.amount);
                if (dayIndex >= 0 && dayIndex < dailyOutflowSeries.length) dailyOutflowSeries[dayIndex] += Math.abs(tx.amount);
            }
        }

        weekBuckets.push({ inflow: inflowSum, outflow: outflowSum });
    }

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
                if (p.direction === "inflow") recurringInflowTotal += p.minAmount * occurrences;
                else recurringOutflowTotal += p.minAmount * occurrences;
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
    const weights: number[] = [];

    const firstActiveIdx = weekBuckets.findIndex(b => b.inflow > 0 || b.outflow > 0);
    const lastActiveIdx = weekBuckets.length - 1 - [...weekBuckets].reverse().findIndex(b => b.inflow > 0 || b.outflow > 0);

    // Recency-weighted: divide the 52-week window into tiers
    // Most recent 4 weeks get full weight, older data decays
    for (let i = 0; i < WEEKS_TO_ANALYZE; i++) {
        // Skip unpopulated weeks outside the active span of uploaded history
        if (firstActiveIdx !== -1 && (i < firstActiveIdx || i > lastActiveIdx)) continue;

        const b = weekBuckets[i];

        const ageWeeks = (WEEKS_TO_ANALYZE - 1) - i;
        let weight = 1.0;
        if (ageWeeks <= 3)  weight = 2.0;   // Weeks 1-4:   highest weight
        else if (ageWeeks <= 7)  weight = 1.5;   // Weeks 5-8:   high weight
        else if (ageWeeks <= 12) weight = 1.0;   // Weeks 9-12:  medium weight
        else if (ageWeeks <= 25) weight = 0.7;   // Weeks 13-26: lower weight
        else                     weight = 0.4;   // Weeks 27-52: background context
        
        inflowValues.push(b.inflow);
        outflowValues.push(b.outflow);
        weights.push(weight);
    }

    // Compute Weighted Mean and StdDev for CV
    const inflowStats = computeWeightedMeanAndStdDev(inflowValues, weights);
    const outflowStats = computeWeightedMeanAndStdDev(outflowValues, weights);

    const inflowCV = inflowStats.mean > 0 ? inflowStats.stddev / inflowStats.mean : 0;
    const outflowCV = outflowStats.mean > 0 ? outflowStats.stddev / outflowStats.mean : 0;

    let variableInflowWeekly = 0;
    let variableOutflowWeekly = 0;
    let conservativeInflowWeekly = 0;
    let conservativeOutflowWeekly = 0;
    let methodNoteStr = "";

    // Inflows: Adaptive Baseline
    if (inflowCV >= 0.8) {
        // Lumpy/Project Business -> Use Recency-Weighted Mean
        variableInflowWeekly = inflowStats.mean;
        conservativeInflowWeekly = Math.max(0, inflowStats.mean - inflowStats.stddev * 0.5);
        methodNoteStr += "Inflows: CV-Adaptive Weighted Mean (Lumpy). ";
    } else {
        // Smooth Business -> Use Recency-Weighted Median
        // Compute unweighted median of trimmed values to avoid freak anomalies
        const trimmedInflows = trimmedValues(inflowValues, 0.05); // 5% trim
        variableInflowWeekly = median(trimmedInflows);
        conservativeInflowWeekly = percentile(trimmedInflows, 25);
        methodNoteStr += "Inflows: CV-Adaptive Weighted Median (Smooth). ";
    }

    // Outflows: Adaptive Baseline
    if (outflowCV >= 0.8) {
        // Lumpy
        variableOutflowWeekly = outflowStats.mean;
        conservativeOutflowWeekly = outflowStats.mean + outflowStats.stddev * 0.5;
        methodNoteStr += "Outflows: CV-Adaptive Weighted Mean (Lumpy).";
    } else {
        // Smooth
        const trimmedOutflows = trimmedValues(outflowValues, 0.05); // 5% trim
        variableOutflowWeekly = median(trimmedOutflows);
        conservativeOutflowWeekly = percentile(trimmedOutflows, 75);
        methodNoteStr += "Outflows: CV-Adaptive Weighted Median (Smooth).";
    }

    const variableInflowBand = variableInflowWeekly > 0
        ? Math.min(0.6, inflowStats.stddev / variableInflowWeekly)
        : 0.3;

    const variableOutflowBand = variableOutflowWeekly > 0
        ? Math.min(0.4, outflowStats.stddev / variableOutflowWeekly)
        : 0.2;

    // Detect Cadence for residual inflows (Fix 2)
    let inflowCadence: number | undefined = undefined;
    let outflowCadence: number | undefined = undefined;

    if (activeWeeks.length >= 4) {
        // max lag 40 days to catch monthly
        const acfInflow = computeACF(dailyInflowSeries, 40);
        // use lower threshold for residual noise
        const dominantInflowLag = detectDominantCadence(acfInflow, 0.35);
        if (dominantInflowLag && dominantInflowLag >= 7) {
            inflowCadence = dominantInflowLag;
            methodNoteStr += ` Detected ${inflowCadence}-day collection rhythm.`;
        }

        const acfOutflow = computeACF(dailyOutflowSeries, 40);
        const dominantOutflowLag = detectDominantCadence(acfOutflow, 0.35);
        if (dominantOutflowLag && dominantOutflowLag >= 7) {
            outflowCadence = dominantOutflowLag;
            methodNoteStr += ` Detected ${outflowCadence}-day outflow rhythm.`;
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
        note: `Computed from ${activeWeeks.length} weeks of bank tx, excluding ${excludedPatterns.length} recurring patterns`,
        methodNote: methodNoteStr.trim(),
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

function mondayBefore(d: Date, weeksAgo: number): Date {
    const dt = new Date(d);
    const day = dt.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    dt.setDate(dt.getDate() + diff - weeksAgo * 7);
    dt.setHours(0, 0, 0, 0);
    return dt;
}

function addWeeks(d: Date, n: number): Date {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n * 7);
    return dt;
}

function addDays(d: Date, n: number): Date {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
}

function daysBetween(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
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
