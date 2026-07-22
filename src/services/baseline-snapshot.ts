import prisma from "@/db/prisma";
import { computeBaseline, BankTxForBaseline, RecurringPatternForBaseline } from "./baseline";

export async function buildAndCacheBaseline(companyId: string) {
    const bankTxs = await prisma.bankTransaction.findMany({
        where: { companyId },
        select: { amount: true, txDate: true, description: true, direction: true },
        orderBy: { txDate: "asc" }
    });

    const recurringPatternsRaw = await prisma.recurringPattern.findMany({
        where: { companyId, status: "active" },
    });

    const cashSnapshot = await prisma.cashSnapshot.findFirst({
        where: { companyId },
        orderBy: { asOfDate: "desc" },
    });

    const assumptionsRaw = await prisma.assumption.findFirst({
        where: { companyId },
    });

    const assumptions = assumptionsRaw ?? {
        payrollAllInAmount: null,
        payrollNextDate: null,
        payrollCadence: "biweekly",
        rentMonthlyAmount: null,
        rentDayOfMonth: null,
    };

    const bankTxsForBaseline: BankTxForBaseline[] = bankTxs.map(tx => ({
        amount: tx.amount,
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

    const asOfDate = cashSnapshot?.asOfDate ?? new Date();

    const baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, asOfDate, {
        payrollAllInAmount: assumptions.payrollAllInAmount,
        payrollNextDate: assumptions.payrollNextDate,
        payrollCadence: assumptions.payrollCadence,
        rentMonthlyAmount: assumptions.rentMonthlyAmount,
        rentDayOfMonth: assumptions.rentDayOfMonth,
    });

    // Save BaselineSnapshot
    await prisma.baselineSnapshot.upsert({
        where: { companyId },
        update: {
            asOfDate,
            hasSufficientHistory: baseline.hasSufficientHistory,
            baselineConfidenceTier: baseline.baselineConfidenceTier,
            inflowCadence: (baseline as any).inflowCadence?.toString() || "1",
            outflowCadence: (baseline as any).outflowCadence?.toString() || "1",
            variableInflowWeekly: baseline.variableInflowWeekly,
            variableOutflowWeekly: baseline.variableOutflowWeekly,
            variableInflowBand: baseline.variableInflowBand,
            variableOutflowBand: baseline.variableOutflowBand,
            conservativeInflowWeekly: baseline.conservativeInflowWeekly,
            conservativeOutflowWeekly: baseline.conservativeOutflowWeekly,
            weeklyBucketsJson: JSON.stringify(baseline.weeklyBuckets),
        },
        create: {
            companyId,
            asOfDate,
            hasSufficientHistory: baseline.hasSufficientHistory,
            baselineConfidenceTier: baseline.baselineConfidenceTier,
            inflowCadence: (baseline as any).inflowCadence?.toString() || "1",
            outflowCadence: (baseline as any).outflowCadence?.toString() || "1",
            variableInflowWeekly: baseline.variableInflowWeekly,
            variableOutflowWeekly: baseline.variableOutflowWeekly,
            variableInflowBand: baseline.variableInflowBand,
            variableOutflowBand: baseline.variableOutflowBand,
            conservativeInflowWeekly: baseline.conservativeInflowWeekly,
            conservativeOutflowWeekly: baseline.conservativeOutflowWeekly,
            weeklyBucketsJson: JSON.stringify(baseline.weeklyBuckets),
        }
    });
}
