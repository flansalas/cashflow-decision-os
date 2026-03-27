// services/baseline.ts – Compute variable inflow/outflow baselines from bank transactions
// Pure logic. No React, no DB imports.
// Strategy A: computes real values from last 8–12 weeks of bank tx,
// excluding detected recurring patterns (payroll, rent, etc.)

export interface BankTxForBaseline {
    amount: number;       // positive = inflow, negative = outflow (caller normalizes sign)
    date: Date;
    merchantKey: string;  // typically the description field from bank tx
}

export interface RecurringPatternForBaseline {
    merchantKey: string;
    direction: string;
    category: string;
    isIncluded: boolean;
}

export interface BaselineResult {
    variableOutflowWeekly: number;
    variableInflowWeekly: number;
    variableOutflowBand: number;   // fractional stddev / mean
    variableInflowBand: number;
    weeksAnalyzed: number;
    hasSufficientHistory: boolean; // true if >= 6 complete weeks of data
    computedFrom: "bank_tx" | "placeholder";
    note: string;
}

// Minimum weeks required to trust the baseline
const MIN_WEEKS_REQUIRED = 6;
const WEEKS_TO_ANALYZE = 12;

export function computeBaseline(
    txs: BankTxForBaseline[],
    patterns: RecurringPatternForBaseline[],
    asOfDate: Date,
): BaselineResult {
    if (txs.length === 0) {
        return placeholderBaseline("No bank transactions available");
    }

    // Build set of recurring merchantKeys to exclude
    const recurringKeys = new Set(
        patterns
            .filter(p => p.isIncluded && ["payroll", "rent", "loan", "card_payment"].includes(p.category))
            .map(p => p.merchantKey.toUpperCase().trim())
    );

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
            if (recurringKeys.has(tx.merchantKey.toUpperCase().trim())) continue;

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

    if (activeWeeks.length < MIN_WEEKS_REQUIRED) {
        return placeholderBaseline(
            `Only ${activeWeeks.length} weeks of transaction history (need ${MIN_WEEKS_REQUIRED})`
        );
    }

    // Compute weighted average using chronological buckets
    // i=0 is oldest (12 weeks ago), i=11 is newest (1 week ago)
    let weightedInflowSum = 0;
    let weightedOutflowSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < WEEKS_TO_ANALYZE; i++) {
        const b = weekBuckets[i];
        if (b.inflow === 0 && b.outflow === 0) continue; // Skip inactive weeks

        const ageWeeks = (WEEKS_TO_ANALYZE - 1) - i; 
        let weight = 1.0;
        // Tiered weights: Most recent 4 weeks get highest weight
        if (ageWeeks <= 3) weight = 1.5;         // Weeks 1-4
        else if (ageWeeks <= 7) weight = 0.9;    // Weeks 5-8
        else weight = 0.6;                       // Weeks 9-12
        
        weightedInflowSum += b.inflow * weight;
        weightedOutflowSum += b.outflow * weight;
        totalWeight += weight;
    }

    const variableInflowWeekly = totalWeight > 0 ? weightedInflowSum / totalWeight : 0;
    const variableOutflowWeekly = totalWeight > 0 ? weightedOutflowSum / totalWeight : 0;

    // Use unweighted values for stddev and band calculations for simplicity
    const inflowValues = activeWeeks.map(b => b.inflow);
    const outflowValues = activeWeeks.map(b => b.outflow);
    const inflowStdDev = stddev(inflowValues);
    const outflowStdDev = stddev(outflowValues);

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
        computedFrom: "bank_tx",
        note: `Computed from ${activeWeeks.length} weeks of bank tx, excluding ${recurringKeys.size} recurring patterns`,
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
