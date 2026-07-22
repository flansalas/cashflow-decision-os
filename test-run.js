const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function normalizeDescription(desc) {
    if (!desc) return "";
    let s = desc.toLowerCase();
    s = s.replace(/[^a-z0-9\s]/g, "");
    s = s.replace(/\s+/g, " ");
    return s.trim();
}

function mondayBefore(date, weeks) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (weeks * 7));
    return d;
}

function daysBetween(date1, date2) {
    return Math.round((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function addWeeks(date, weeks) {
    return addDays(date, weeks * 7);
}

function computeBaseline(txs, patternsForBaseline, asOfDate, assumptions) {
    const excludedPatterns = patternsForBaseline
        .filter(p => p.isIncluded)
        .map(p => {
            const isVolatile = ["utilities", "fuel", "taxes", "card_payment", "payroll"].includes(p.category);
            const tolerance = isVolatile ? 0.5 : 0.2;
            return {
                key: normalizeDescription(p.merchantKey || ""),
                direction: p.direction,
                minAmount: p.typicalAmount - Math.max(p.typicalAmount * tolerance, p.amountStdDev * 2),
                maxAmount: p.typicalAmount + Math.max(p.typicalAmount * tolerance, p.amountStdDev * 2),
                cadence: p.cadence,
                lastMatchedDate: null
            };
        });

    let lastPayrollMatchedDate = null;
    const WEEKS_TO_ANALYZE = 52;
    const weekBuckets = [];
    const weekStart0 = mondayBefore(asOfDate, WEEKS_TO_ANALYZE);

    for (let i = 0; i < WEEKS_TO_ANALYZE; i++) {
        const wStart = addWeeks(weekStart0, i);
        const wEnd = addDays(wStart, 6);

        let inflowSum = 0;
        let outflowSum = 0;

        for (const tx of txs) {
            if (tx.date < wStart || tx.date > wEnd) continue;

            const txDirection = tx.amount > 0 ? "inflow" : "outflow";
            const absAmount = Math.abs(tx.amount);
            let matchesAssumption = false;

            if (txDirection === "outflow") {
                if (
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
            }

            if (matchesAssumption) continue;

            const matchedPattern = excludedPatterns.find(p => {
                if (p.direction !== txDirection) return false;
                if (absAmount < p.minAmount || absAmount > p.maxAmount) return false;
                
                if (p.lastMatchedDate) {
                    const daysSince = Math.abs(daysBetween(p.lastMatchedDate, tx.date));
                    const cooldown = p.cadence === "weekly" ? 5 : p.cadence === "biweekly" ? 10 : 20;
                    if (daysSince < cooldown) return false;
                }
                
                return true;
            });

            if (matchedPattern) {
                matchedPattern.lastMatchedDate = tx.date;
                continue;
            }

            if (tx.amount > 0) {
                inflowSum += tx.amount;
            } else {
                outflowSum += Math.abs(tx.amount);
            }
        }
        weekBuckets.push({ inflow: inflowSum, outflow: outflowSum });
    }

    let weightedOutflowSum = 0;
    let weightSum = 0;
    for (let i = 0; i < weekBuckets.length; i++) {
        const ageWeeks = (WEEKS_TO_ANALYZE - 1) - i;
        let weight = 1.0;
        if (ageWeeks <= 3) weight = 2.0;
        else if (ageWeeks <= 7) weight = 1.5;
        else if (ageWeeks <= 12) weight = 1.0;
        else if (ageWeeks <= 25) weight = 0.7;
        else weight = 0.4;

        weightedOutflowSum += (weekBuckets[i].outflow * weight);
        weightSum += weight;
    }

    return {
        variableOutflowWeekly: weightedOutflowSum / weightSum,
        unweightedAvg: weekBuckets.reduce((s, b) => s + b.outflow, 0) / WEEKS_TO_ANALYZE
    };
}

async function run() {
    const cid = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
    const bankTxs = await prisma.bankTransaction.findMany({
        where: { companyId: cid },
        select: { amount: true, txDate: true, description: true, direction: true },
        orderBy: { txDate: "asc" }
    });
    const recurringPatternsRaw = await prisma.recurringPattern.findMany({
        where: { companyId: cid, status: "active" },
    });
    const assumptionsRaw = await prisma.assumption.findFirst({
        where: { companyId: cid },
    });
    const cashSnapshot = await prisma.cashSnapshot.findFirst({
        where: { companyId: cid },
        orderBy: { asOfDate: "desc" },
    });

    const bankTxsForBaseline = bankTxs.map(tx => ({
        amount: tx.amount,
        date: tx.txDate,
        merchantKey: tx.description || "",
    }));

    const patternsForBaseline = recurringPatternsRaw.map(rp => ({
        merchantKey: rp.merchantKey || rp.displayName,
        direction: rp.direction,
        category: rp.category,
        isIncluded: rp.isIncluded,
        typicalAmount: rp.typicalAmount,
        amountStdDev: rp.amountStdDev,
        cadence: rp.cadence,
    }));

    const baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, cashSnapshot.asOfDate, {
        payrollAllInAmount: assumptionsRaw?.payrollAllInAmount,
        payrollNextDate: assumptionsRaw?.payrollNextDate,
        payrollCadence: assumptionsRaw?.payrollCadence,
        rentMonthlyAmount: assumptionsRaw?.rentMonthlyAmount,
        rentDayOfMonth: assumptionsRaw?.rentDayOfMonth,
    });

    console.log(baseline);
}

run().catch(console.error).finally(() => prisma.$disconnect());
