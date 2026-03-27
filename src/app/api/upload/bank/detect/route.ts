// POST /api/upload/bank/detect
// Reads stored BankTransactions for a company, runs pattern detection,
// returns suggestions (no DB writes). Call AFTER bank upload is complete.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { detectPatterns, type BankTxForDetection } from "@/services/detectPatterns";

export async function POST(req: NextRequest) {
    const { companyId } = await req.json() as { companyId: string };

    if (!companyId) {
        return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    }

    try {
        // Load stored bank transactions
        const bankTxs = await prisma.bankTransaction.findMany({
            where: { companyId },
            select: { txDate: true, amount: true, description: true, direction: true },
            orderBy: { txDate: "asc" },
        });

        if (bankTxs.length === 0) {
            return NextResponse.json({ suggestions: [] });
        }

        // Load existing recurring pattern merchant keys to avoid duplicates
        const existingPatterns = await prisma.recurringPattern.findMany({
            where: { companyId },
            select: { merchantKey: true },
        });
        const existingKeys = new Set(existingPatterns.map(p => p.merchantKey.toLowerCase()));

        // Run detection
        const txsForDetection: BankTxForDetection[] = bankTxs.map(tx => ({
            txDate: tx.txDate,
            amount: tx.amount,
            description: tx.description,
            direction: tx.direction as "inflow" | "outflow",
        }));

        const asOfDate = new Date();
        const suggestions = detectPatterns(txsForDetection, asOfDate, existingKeys);

        return NextResponse.json({
            suggestions,
            totalTransactions: bankTxs.length,
        });
    } catch (error) {
        console.error("Bank detect error:", error);
        return NextResponse.json({ error: "Detection failed" }, { status: 500 });
    }
}
