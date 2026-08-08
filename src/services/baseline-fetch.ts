import prisma from "@/db/prisma";
import type { BankTxForBaseline, RecurringPatternForBaseline } from "./baseline";

export async function getCanonicalBaselineInputs(companyId: string) {
    const bankTxsRaw = await prisma.bankTransaction.findMany({
        where: { companyId },
        select: { amount: true, txDate: true, description: true, direction: true, internalTransferStatus: true },
        orderBy: { txDate: "asc" }
    });

    const recurringPatternsRaw = await prisma.recurringPattern.findMany({
        where: { companyId, status: "active" },
    });

    const bankTxsForBaseline: BankTxForBaseline[] = bankTxsRaw.map(tx => ({
        // Confirmed internal transfers (resolved) are excluded — they inflate both
        // inflow and outflow totals and would double-count real operating cash.
        amount: tx.internalTransferStatus === 'resolved' ? 0 : (tx.direction === 'outflow' ? -tx.amount : tx.amount),
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
        cadence: rp.cadence as any,
    }));

    return {
        bankTxsRaw,
        recurringPatternsRaw,
        bankTxsForBaseline,
        patternsForBaseline
    };
}
