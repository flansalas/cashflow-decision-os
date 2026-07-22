const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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

async function run() {
    const cid = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
    const bankTxs = await prisma.bankTransaction.findMany({
        where: { companyId: cid },
        select: { amount: true, txDate: true, description: true, direction: true },
        orderBy: { txDate: "asc" }
    });
    const recurringPatternsRaw = await prisma.recurringPattern.findMany({
        where: { companyId: cid, status: "active", isIncluded: true },
    });
    const assumptions = await prisma.assumption.findFirst({
        where: { companyId: cid },
    });

    const excludedPatterns = recurringPatternsRaw.map(p => {
        const isVolatile = ["utilities", "fuel", "taxes", "card_payment", "payroll"].includes(p.category);
        const tolerance = isVolatile ? 0.5 : 0.2;
        return {
            name: p.displayName,
            direction: p.direction,
            minAmount: p.typicalAmount - Math.max(p.typicalAmount * tolerance, p.amountStdDev * 2),
            maxAmount: p.typicalAmount + Math.max(p.typicalAmount * tolerance, p.amountStdDev * 2),
            cadence: p.cadence,
            lastMatchedDate: null
        };
    });

    const WEEKS_TO_ANALYZE = 52;
    const asOfDate = new Date('2026-07-20T04:00:00.000Z');
    const weekStart0 = mondayBefore(asOfDate, WEEKS_TO_ANALYZE);
    let lastPayrollMatchedDate = null;
    let excludedTotal = 0;
    const exclusions = {};

    for (let i = 0; i < WEEKS_TO_ANALYZE; i++) {
        const wStart = addWeeks(weekStart0, i);
        const wEnd = addDays(wStart, 6);

        for (const tx of bankTxs) {
            if (tx.txDate < wStart || tx.txDate > wEnd) continue;
            if (tx.amount >= 0) continue;
            const absAmount = Math.abs(tx.amount);
            
            let matched = false;

            // Payroll check
            if (
                assumptions.payrollAllInAmount &&
                assumptions.payrollNextDate &&
                absAmount >= assumptions.payrollAllInAmount * 0.5 &&
                absAmount <= assumptions.payrollAllInAmount * 1.5
            ) {
                let canMatch = true;
                if (lastPayrollMatchedDate) {
                    const daysSince = Math.abs(daysBetween(lastPayrollMatchedDate, tx.txDate));
                    const cooldown = assumptions.payrollCadence === "weekly" ? 5 : assumptions.payrollCadence === "biweekly" ? 10 : 20;
                    if (daysSince < cooldown) canMatch = false;
                }
                
                if (canMatch) {
                    const daysDiff = Math.abs(daysBetween(tx.txDate, assumptions.payrollNextDate));
                    const cadenceDays = assumptions.payrollCadence === "weekly" ? 7 : assumptions.payrollCadence === "biweekly" ? 14 : 30;
                    const remainder = daysDiff % cadenceDays;
                    const toleranceDays = cadenceDays === 7 ? 1 : 3;
                    if (remainder <= toleranceDays || remainder >= cadenceDays - toleranceDays) {
                        lastPayrollMatchedDate = tx.txDate;
                        matched = true;
                        exclusions["PAYROLL"] = (exclusions["PAYROLL"] || 0) + absAmount;
                        excludedTotal += absAmount;
                    }
                }
            }

            if (matched) continue;

            const matchedPattern = excludedPatterns.find(p => {
                if (p.direction !== 'outflow') return false;
                if (absAmount < p.minAmount || absAmount > p.maxAmount) return false;
                if (p.lastMatchedDate) {
                    const daysSince = Math.abs(daysBetween(p.lastMatchedDate, tx.txDate));
                    const cooldown = p.cadence === "weekly" ? 5 : p.cadence === "biweekly" ? 10 : 20;
                    if (daysSince < cooldown) return false;
                }
                return true;
            });

            if (matchedPattern) {
                matchedPattern.lastMatchedDate = tx.txDate;
                exclusions[matchedPattern.name] = (exclusions[matchedPattern.name] || 0) + absAmount;
                excludedTotal += absAmount;
            }
        }
    }

    console.log("Excluded Outflow Total:", excludedTotal, "-> Avg:", excludedTotal / 52);
    console.log("Breakdown:");
    Object.entries(exclusions).sort((a,b) => b[1] - a[1]).forEach(([name, sum]) => {
        console.log(`  ${name}: ${sum} (Avg: ${sum/52})`);
    });
}
run().catch(console.error).finally(() => prisma.$disconnect());
