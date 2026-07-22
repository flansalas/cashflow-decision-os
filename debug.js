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
function daysBetween(date1, date2) { return Math.round((date2.getTime() - date1.getTime()) / 86400000); }
function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d; }
function addWeeks(date, weeks) { return addDays(date, weeks * 7); }

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

    const excludedPatterns = recurringPatternsRaw
        .filter(p => p.isIncluded)
        .map(p => {
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

    let lastPayrollMatchedDate = null;
    const WEEKS_TO_ANALYZE = 52;
    const asOfDate = new Date('2026-07-20T04:00:00.000Z');
    const weekStart0 = mondayBefore(asOfDate, WEEKS_TO_ANALYZE);

    let totalOutflowSum = 0;
    
    // Log arrays
    const excludedList = [];

    for (let i = 0; i < WEEKS_TO_ANALYZE; i++) {
        const wStart = addWeeks(weekStart0, i);
        const wEnd = addDays(wStart, 6);
        let outflowSum = 0;

        for (const tx of bankTxs) {
            if (tx.txDate < wStart || tx.txDate > wEnd) continue;
            
            const txDirection = tx.amount > 0 ? "inflow" : "outflow";
            if (txDirection !== "outflow") continue;

            const absAmount = Math.abs(tx.amount);
            let matchesAssumption = false;

            if (assumptionsRaw?.payrollAllInAmount && assumptionsRaw?.payrollNextDate &&
                absAmount >= assumptionsRaw.payrollAllInAmount * 0.5 &&
                absAmount <= assumptionsRaw.payrollAllInAmount * 1.5) {
                
                let canMatch = true;
                if (lastPayrollMatchedDate) {
                    const daysSince = Math.abs(daysBetween(lastPayrollMatchedDate, tx.txDate));
                    const cooldown = assumptionsRaw.payrollCadence === "weekly" ? 5 : assumptionsRaw.payrollCadence === "biweekly" ? 10 : 20;
                    if (daysSince < cooldown) canMatch = false;
                }
                if (canMatch) {
                    const daysDiff = Math.abs(daysBetween(tx.txDate, assumptionsRaw.payrollNextDate));
                    const cadenceDays = assumptionsRaw.payrollCadence === "weekly" ? 7 : assumptionsRaw.payrollCadence === "biweekly" ? 14 : 30;
                    const remainder = daysDiff % cadenceDays;
                    const toleranceDays = cadenceDays === 7 ? 1 : 3;
                    if (remainder <= toleranceDays || remainder >= cadenceDays - toleranceDays) {
                        matchesAssumption = true;
                        lastPayrollMatchedDate = tx.txDate;
                        excludedList.push({ type: 'payroll', amount: absAmount, date: tx.txDate });
                    }
                }
            }

            if (matchesAssumption) continue;

            const matchedPattern = excludedPatterns.find(p => {
                if (p.direction !== txDirection) return false;
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
                excludedList.push({ type: matchedPattern.name, amount: absAmount, date: tx.txDate });
                continue;
            }

            outflowSum += absAmount;
        }
        totalOutflowSum += outflowSum;
    }

    console.log("Variable Avg:", totalOutflowSum / 52);
}

run().catch(console.error).finally(() => prisma.$disconnect());
