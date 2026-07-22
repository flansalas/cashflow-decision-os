import { computeBaseline } from "./src/services/baseline";
import prisma from "./src/db/prisma";

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

    const bankTxsForBaseline = bankTxs.map(tx => ({
        amount: tx.amount,
        date: tx.txDate,
        merchantKey: tx.description ?? "",
    }));

    const patternsForBaseline = recurringPatternsRaw.map(rp => ({
        merchantKey: rp.merchantKey ?? rp.displayName,
        direction: rp.direction as any,
        category: rp.category,
        isIncluded: rp.isIncluded,
        typicalAmount: rp.typicalAmount,
        amountStdDev: rp.amountStdDev,
        cadence: rp.cadence as any,
    }));

    const baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, new Date('2026-07-20T04:00:00.000Z'), {
        payrollAllInAmount: assumptionsRaw?.payrollAllInAmount ?? null,
        payrollNextDate: assumptionsRaw?.payrollNextDate ?? null,
        payrollCadence: (assumptionsRaw?.payrollCadence as any) ?? "biweekly",
        rentMonthlyAmount: assumptionsRaw?.rentMonthlyAmount ?? null,
        rentDayOfMonth: assumptionsRaw?.rentDayOfMonth ?? null,
    });

    console.log("Variable Outflow Weekly:", baseline.variableOutflowWeekly);
}

run().catch(console.error).finally(() => process.exit(0));
