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
    weeksAnalyzed: number;
    hasSufficientHistory: boolean; // true if >= 2 complete weeks of data
    baselineConfidenceTier: BaselineConfidenceTier; // "high" 6+ wks | "med" 3-5 | "low" 1-2 | "none" 0
    computedFrom: "bank_tx" | "placeholder";
    note: string;
}

export interface BaselineAssumptions {
    payrollAllInAmount: number | null;
    payrollNextDate: Date | null;
    payrollCadence: string;
    rentMonthlyAmount: number | null;
    rentDayOfMonth: number | null;
}

// Minimum weeks required to enable gap-fill projections (was 6, now 2 for always-on)
export const MIN_WEEKS_REQUIRED = 2;
const WEEKS_TO_ANALYZE = 12;

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

    for (let i = 0; i < WEEKS_TO_ANALYZE; i++) {
        const wStart = addWeeks(weekStart0, i);
        const wEnd = addDays(wStart, 6);

        let inflowSum = 0;
        let outflowSum = 0;

        for (const tx of txs) {
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
                    if (remainder <= 3 || remainder >= cadenceDays - 3) {
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

            if (tx.amount > 0) {
                inflowSum += tx.amount;
            } else {
                outflowSum += Math.abs(tx.amount);
            }
        }

        weekBuckets.push({ inflow: inflowSum, outflow: outflowSum });
    }

    // Find weeks with at least some activity
    const activeWeeks = weekBuckets.filter(b => b.inflow > 0 || b.outflow > 0);

    // SPAN-BASED FALLBACK: if transactions are concentrated in few weeks but the
    // date range covers meaningful history, compute weekly average from total / span.
    // This handles cases where bank data was uploaded as a batch (all same dates).
    if (activeWeeks.length < MIN_WEEKS_REQUIRED) {
        // Measure span from the OLDEST transaction date to asOfDate
        // (not min-to-max tx dates, which fails when all txs are the same day)
        const txDates = txs.map(t => t.date.getTime());
        const oldestTxDate = Math.min(...txDates);
        const daySpan = (asOfDate.getTime() - oldestTxDate) / 86_400_000;
        
        if (daySpan >= 1) {
            // We have a usable span — compute weekly average from totals over that span
            const weeksSpan = Math.max(1, daySpan / 7);
            const totalInflow = txs.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
            const totalOutflow = txs.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

            // Subtract known recurring amounts from the total
            // (rough estimate: N occurrences ≈ weeksSpan / cadence, conservative: weekly cadence)
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
                variableOutflowBand: 0.35,   // wider band = more uncertainty
                variableInflowBand: 0.45,
                weeksAnalyzed: Math.round(weeksSpan),
                hasSufficientHistory: true,
                baselineConfidenceTier: tier,
                computedFrom: "bank_tx",
                note: `Span-based estimate: ${Math.round(daySpan)}d window → $${Math.round(weeklyInflow).toLocaleString()} inflow/wk (${tier} confidence)`,
            };
        }

        return placeholderBaseline(
            `Only ${activeWeeks.length} weeks of transaction history (need ${MIN_WEEKS_REQUIRED})`
        );
    }

    const inflowValues: number[] = [];
    const outflowValues: number[] = [];
    const weights: number[] = [];

    // Compute weights and build arrays for robust statistics
    for (let i = 0; i < WEEKS_TO_ANALYZE; i++) {
        const b = weekBuckets[i];
        if (b.inflow === 0 && b.outflow === 0) continue; // Skip inactive weeks

        const ageWeeks = (WEEKS_TO_ANALYZE - 1) - i; 
        let weight = 1.0;
        // Tiered weights: Most recent 4 weeks get highest weight
        if (ageWeeks <= 3) weight = 1.5;         // Weeks 1-4
        else if (ageWeeks <= 7) weight = 0.9;    // Weeks 5-8
        else weight = 0.6;                       // Weeks 9-12
        
        inflowValues.push(b.inflow);
        outflowValues.push(b.outflow);
        weights.push(weight);
    }

    // Apply basic outlier shielding (cap at 2.5x median)
    const cappedInflows = clipOutliers(inflowValues);
    const cappedOutflows = clipOutliers(outflowValues);

    const calcStat = computeWeightedMeanAndStdDev(cappedInflows, weights);
    const variableInflowWeekly = calcStat.mean;
    const inflowStdDev = calcStat.stddev;

    const calcOutStat = computeWeightedMeanAndStdDev(cappedOutflows, weights);
    const variableOutflowWeekly = calcOutStat.mean;
    const outflowStdDev = calcOutStat.stddev;

    const variableInflowBand = variableInflowWeekly > 0
        ? Math.min(0.6, inflowStdDev / variableInflowWeekly)
        : 0.3;

    const variableOutflowBand = variableOutflowWeekly > 0
        ? Math.min(0.4, outflowStdDev / variableOutflowWeekly)
        : 0.2;

    return {
        variableOutflowWeekly: Math.round(variableOutflowWeekly * 100) / 100,
        variableInflowWeekly: Math.round(variableInflowWeekly * 100) / 100,
        variableOutflowBand: Math.round(variableOutflowBand * 100) / 100,
        variableInflowBand: Math.round(variableInflowBand * 100) / 100,
        weeksAnalyzed: activeWeeks.length,
        hasSufficientHistory: true,
        baselineConfidenceTier: toBaselineTier(activeWeeks.length),
        computedFrom: "bank_tx",
        note: `Computed from ${activeWeeks.length} weeks of bank tx, excluding ${excludedPatterns.length} recurring patterns`,
    };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function placeholderBaseline(reason: string): BaselineResult {
    return {
        variableOutflowWeekly: 0,
        variableInflowWeekly: 0,
        variableOutflowBand: 0.2,
        variableInflowBand: 0.3,
        weeksAnalyzed: 0,
        hasSufficientHistory: false,
        baselineConfidenceTier: "none",
        computedFrom: "placeholder",
        note: `Baseline uses placeholder defaults — ${reason}`,
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
