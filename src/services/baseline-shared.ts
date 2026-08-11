import { normalizeDescription, categorize, isRecurringIdentityMatch } from "./detectPatterns";
import { BankTxForBaseline, RecurringPatternForBaseline, BaselineAssumptions } from "./baseline";

export function mondayBefore(d: Date, weeksAgo: number): Date {
    const dt = new Date(d);
    const day = dt.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    dt.setUTCDate(dt.getUTCDate() + diff - weeksAgo * 7);
    dt.setUTCHours(0, 0, 0, 0);
    return dt;
}

export function addWeeks(d: Date, n: number): Date {
    const dt = new Date(d);
    dt.setUTCDate(dt.getUTCDate() + n * 7);
    return dt;
}

export function addDays(d: Date, n: number): Date {
    const dt = new Date(d);
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt;
}

export function daysBetween(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function prepareBaselineTransactions(
    txs: BankTxForBaseline[],
    patterns: RecurringPatternForBaseline[],
    asOfDate: Date,
    assumptions: BaselineAssumptions | undefined,
    weeksToAnalyze: number
) {
    const excludedPatterns = patterns
        .filter(p => p.isIncluded)
        .map(p => {
            const isVolatile = ["utilities", "fuel", "taxes", "card_payment", "payroll"].includes(p.category);
            const tolerance = isVolatile ? 0.5 : 0.2;
            return {
                merchantKey: (p.merchantKey || p.displayName || ""),
                displayName: p.displayName || "",
                direction: p.direction,
                typicalAmount: p.typicalAmount,
                amountStdDev: p.amountStdDev,
                cadence: p.cadence,
                minAmount: p.minAmount || p.typicalAmount * (1 - tolerance),
                maxAmount: p.maxAmount || p.typicalAmount * (1 + tolerance),
                lastMatchedDate: null as Date | null
            };
        });

    let lastPayrollMatchedDate: Date | null = null;
    const weekBuckets: { inflow: number; outflow: number }[] = [];
    const weekStart0 = mondayBefore(asOfDate, weeksToAnalyze);
    const dailyInflowSeries = new Array(weeksToAnalyze * 7).fill(0);
    const dailyOutflowSeries = new Array(weeksToAnalyze * 7).fill(0);

    for (let i = 0; i < weeksToAnalyze; i++) {
        const wStart = addWeeks(weekStart0, i);
        const nextWStart = addWeeks(wStart, 1);

        let inflowSum = 0;
        let outflowSum = 0;

        for (const tx of txs) {
            if (!tx.date || isNaN(tx.date.getTime())) continue;
            if (tx.date < wStart || tx.date >= nextWStart) continue;
            
            const txDirection = tx.amount >= 0 ? "inflow" : "outflow";
            const absAmount = Math.abs(tx.amount);
            const txCategory = categorize(tx.merchantKey || "");

            let matchesAssumption = false;
            if (assumptions) {
                if (
                    assumptions.payrollAllInAmount &&
                    txDirection === "outflow" &&
                    txCategory === "payroll"
                ) {
                    matchesAssumption = true;
                }

                if (
                    !matchesAssumption &&
                    assumptions.payrollAllInAmount &&
                    assumptions.payrollNextDate &&
                    txDirection === "outflow" &&
                    absAmount >= assumptions.payrollAllInAmount * 0.5 &&
                    absAmount <= assumptions.payrollAllInAmount * 1.5
                ) {
                    let canMatch = true;
                    if (lastPayrollMatchedDate) {
                        const daysSince = Math.abs(daysBetween(lastPayrollMatchedDate, tx.date));
                        const cooldown = assumptions.payrollCadence === "weekly" ? 5 : assumptions.payrollCadence === "biweekly" ? 10 : 20;
                        if (daysSince < cooldown) canMatch = false;
                    }
                    
                    if (canMatch) {
                        const daysDiff = Math.abs(daysBetween(tx.date, assumptions.payrollNextDate));
                        const cadenceDays = assumptions.payrollCadence === "weekly" ? 7 : assumptions.payrollCadence === "biweekly" ? 14 : 30;
                        const remainder = daysDiff % cadenceDays;
                        const toleranceDays = cadenceDays === 7 ? 1 : 3;
                        if (remainder <= toleranceDays || remainder >= cadenceDays - toleranceDays) {
                            matchesAssumption = true;
                            lastPayrollMatchedDate = tx.date;
                        }
                    }
                }

                if (
                    !matchesAssumption &&
                    assumptions.rentMonthlyAmount &&
                    assumptions.rentDayOfMonth &&
                    txCategory === "rent" &&
                    txDirection === "outflow"
                ) {
                    const txDay = tx.date.getUTCDate();
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

            const matchedPattern = excludedPatterns.find(p => {
                return isRecurringIdentityMatch(
                    { description: tx.merchantKey, direction: txDirection, amount: absAmount, txDate: tx.date },
                    p,
                    p.lastMatchedDate,
                    p.cadence
                );
            });

            if (matchedPattern) {
                matchedPattern.lastMatchedDate = tx.date;
                continue;
            }

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
    return { weekBuckets, dailyInflowSeries, dailyOutflowSeries };
}
