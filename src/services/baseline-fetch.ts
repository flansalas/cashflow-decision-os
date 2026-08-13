import prisma from "@/db/prisma";
import type { BankTxForBaseline, RecurringPatternForBaseline } from "./baseline";

export type BankTransactionForNormalization = {
    amount: number;
    direction: string;
    internalTransferStatus?: string | null;
};

/** Direction is authoritative; stored amount sign is not. */
export function normalizeBankTransactionAmount(tx: BankTransactionForNormalization): number {
    if (tx.internalTransferStatus === "resolved" || tx.internalTransferStatus === "confirmed") return 0;

    const magnitude = Math.abs(tx.amount);
    if (tx.direction === "outflow") return -magnitude;
    if (tx.direction === "inflow") return magnitude;
    return tx.amount;
}

import { PrismaClient } from "@prisma/client";

export async function getCanonicalBaselineInputs(companyId: string, db: any = prisma) {
    const prismaDb = db as PrismaClient;
    const bankTxsRaw = await prismaDb.bankTransaction.findMany({
        where: { companyId },
        select: {
            amount: true,
            txDate: true,
            description: true,
            direction: true,
            internalTransferStatus: true,
            account: { select: { name: true, role: true } },
        },
        orderBy: { txDate: "asc" }
    });

    const recurringPatternsRaw = await prismaDb.recurringPattern.findMany({
        where: { companyId, status: "active" },
    });

    const bankTxsForBaseline: BankTxForBaseline[] = bankTxsRaw.map(tx => ({
        // Confirmed internal transfers (resolved) are excluded — they inflate both
        // inflow and outflow totals and would double-count real operating cash.
        amount: normalizeBankTransactionAmount(tx),
        date: tx.txDate,
        merchantKey: tx.description ?? "",
        accountName: tx.account?.name ?? null,
        accountRole: tx.account?.role ?? "operating",
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
