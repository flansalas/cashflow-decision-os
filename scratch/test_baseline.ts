import prisma from "../src/db/prisma";
import { computeBaseline, type BankTxForBaseline, type RecurringPatternForBaseline } from "../src/services/baseline";
import { computeCOGSCorrelation } from "../src/services/cogs-correlation";

async function main() {
    const company = await prisma.company.findFirst({ where: { name: "Cascio and Sons Construction" } });
    if (!company) throw new Error("No company");

    const cid = company.id;

    const [bankTxs, recurringPatternsRaw, cashSnapshot] = await Promise.all([
        prisma.bankTransaction.findMany({
            where: { companyId: cid, txDate: { gte: new Date(Date.now() - 365 * 86_400_000) } },
            select: { amount: true, txDate: true, description: true, direction: true },
        }),
        prisma.recurringPattern.findMany({ where: { companyId: cid } }),
        prisma.cashSnapshot.findFirst({ where: { companyId: cid }, orderBy: { asOfDate: "desc" } }),
    ]);

    const bankTxsForBaseline: BankTxForBaseline[] = bankTxs.map(tx => ({
        amount: tx.direction === "inflow" ? tx.amount : -tx.amount,
        date: tx.txDate,
        merchantKey: tx.description ?? "",
    }));

    const patternsForBaseline: RecurringPatternForBaseline[] = recurringPatternsRaw.map(rp => ({
        merchantKey: rp.merchantKey ?? rp.displayName,
        direction: rp.direction,
        category: rp.category,
        isIncluded: rp.isIncluded,
        typicalAmount: rp.typicalAmount,
        amountStdDev: rp.amountStdDev,
    }));

    const baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, cashSnapshot!.asOfDate, {
        payrollAllInAmount: 50000,
        payrollNextDate: null,
        payrollCadence: "biweekly",
        rentMonthlyAmount: 10000,
        rentDayOfMonth: 1,
    });

    console.log("Baseline Results:", {
        variableInflowWeekly: baseline.variableInflowWeekly,
        variableOutflowWeekly: baseline.variableOutflowWeekly,
        conservativeInflowWeekly: baseline.conservativeInflowWeekly,
        conservativeOutflowWeekly: baseline.conservativeOutflowWeekly,
    });

    const cogs = computeCOGSCorrelation(baseline.weeklyBuckets);
    console.log("COGS Correlation:", {
        cashMarginRatio: cogs.cashMarginRatio,
        cogsLagWeeks: cogs.cogsLagWeeks,
        validWeeksCount: baseline.weeklyBuckets.length,
    });

    // Let's also check variance multiplier
    const varianceLedger = await prisma.baselineVarianceLedger.findMany({
        where: { companyId: cid },
        orderBy: { weekStart: "desc" },
        take: 8,
    });
    
    console.log("Variance Ledger:");
    varianceLedger.forEach(v => {
        console.log(`  Week ${v.weekStart.toISOString().split('T')[0]}: Out=${v.variancePct.toFixed(2)}, In=${v.variancePctIn?.toFixed(2)}`);
    });
}

main().catch(console.error);
