// POST /api/upload/bank/detect
// Reads stored BankTransactions for a company, runs pattern detection,
// returns suggestions (no DB writes). Call AFTER bank upload is complete.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { detectPatterns, type BankTxForDetection } from "@/services/detectPatterns";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";

export async function POST(req: NextRequest) {
    let bodyCompanyId: string | undefined;
    try {
        const body = await req.json() as { companyId?: string };
        bodyCompanyId = body.companyId;
    } catch {}

    let tenantId = await resolveTenant(req);
    if (!tenantId && bodyCompanyId) {
        const comp = await prisma.company.findUnique({ where: { id: bodyCompanyId }, select: { id: true } });
        if (comp) tenantId = comp.id;
    }
    if (!tenantId) return NextResponse.json({ error: "Missing or invalid company" }, { status: 401 });

    const companyId = tenantId;

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

        // Load existing recurring patterns for matching
        const existingPatterns = await prisma.recurringPattern.findMany({
            where: { companyId },
            select: { id: true, merchantKey: true, typicalAmount: true, cadence: true },
        });
        const existingMap = new Map(existingPatterns.map(p => [p.merchantKey.toLowerCase(), p]));

        // Run detection on all transactions (passing empty set to not skip any)
        const txsForDetection: BankTxForDetection[] = bankTxs.map(tx => ({
            txDate: tx.txDate,
            amount: tx.amount,
            description: tx.description,
            direction: tx.direction as "inflow" | "outflow",
        }));

        const asOfDate = new Date();
        const allSuggestions = detectPatterns(txsForDetection, asOfDate, new Set());

        const newSuggestions = [];
        const updateSuggestions = [];

        for (const sug of allSuggestions) {
            const match = existingMap.get(sug.merchantKey.toLowerCase());
            if (match) {
                // Check if it drifted significantly (>5%) or cadence changed
                const drift = Math.abs(sug.typicalAmount - match.typicalAmount) / match.typicalAmount;
                if (drift > 0.05 || sug.cadence !== match.cadence) {
                    updateSuggestions.push({
                        ...sug,
                        isUpdate: true,
                        existingId: match.id,
                        oldAmount: match.typicalAmount,
                        oldCadence: match.cadence,
                    });
                }
            } else {
                newSuggestions.push(sug);
            }
        }

        return NextResponse.json({
            suggestions: newSuggestions,
            updateSuggestions,
            totalTransactions: bankTxs.length,
        });
    } catch (error) {
        console.error("Bank detect error:", error);
        return NextResponse.json({ error: "Detection failed" }, { status: 500 });
    }
}
