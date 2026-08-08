// POST /api/upload/bank/detect
// Reads stored BankTransactions for a company, runs pattern detection,
// returns suggestions classified into four buckets (no DB writes).
// Call AFTER bank upload is complete.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export const maxDuration = 300; // Allow 5 minutes for pattern detection on 1,600+ rows
import { detectPatterns, classifyDetectedPattern, type BankTxForDetection } from "@/services/detectPatterns";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";

export async function POST(req: NextRequest) {
    // ── Tenant isolation: authenticated identity is authoritative ──────────
    // A body-supplied companyId MUST NOT become the tenant identity if
    // resolveTenant() fails. We validate body companyId against the
    // authenticated tenant only.
    const authResult = await auth();
    if (!authResult?.userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = await resolveTenant(req);
    if (!tenantId) {
        return NextResponse.json({ error: "Missing or invalid company" }, { status: 401 });
    }

    // If the client sent a companyId, it must match the authenticated tenant.
    let bodyCompanyId: string | undefined;
    try {
        const body = await req.json() as { companyId?: string };
        bodyCompanyId = body.companyId;
    } catch { /* body is optional */ }

    if (bodyCompanyId && bodyCompanyId !== tenantId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const companyId = tenantId;

    try {
        // Load stored bank transactions
        const bankTxs = await prisma.bankTransaction.findMany({
            where: { companyId },
            select: { txDate: true, amount: true, description: true, direction: true },
            orderBy: { txDate: "asc" },
        });

        if (bankTxs.length === 0) {
            return NextResponse.json({ suggestions: [], updateSuggestions: [], ambiguousSuggestions: [], totalTransactions: 0 });
        }

        // Load existing recurring patterns for classification
        const existingPatterns = await prisma.recurringPattern.findMany({
            where: { companyId },
            select: { id: true, merchantKey: true, displayName: true, typicalAmount: true, cadence: true, direction: true, category: true, isIncluded: true, isCritical: true },
        });

        // Run detection on all transactions
        const txsForDetection: BankTxForDetection[] = bankTxs.map(tx => ({
            txDate: tx.txDate,
            amount: tx.amount,
            description: tx.description,
            direction: tx.direction as "inflow" | "outflow",
        }));

        const asOfDate = new Date();
        const allSuggestions = detectPatterns(txsForDetection, asOfDate, new Set());

        // Classify each suggestion using multi-signal classification
        const newSuggestions = [];
        const updateSuggestions = [];
        const ambiguousSuggestions = [];
        const alreadyRepresented = [];

        for (const sug of allSuggestions) {
            const result = classifyDetectedPattern(
                {
                    merchantKey: sug.merchantKey,
                    displayName: sug.displayName,
                    typicalAmount: sug.typicalAmount,
                    cadence: sug.cadence,
                    direction: "outflow",
                },
                existingPatterns
            );

            switch (result.classification) {
                case "already_represented":
                    alreadyRepresented.push({
                        ...sug,
                        existingId: result.matchedPatternId,
                        existingDisplayName: result.matchedPatternDisplayName,
                    });
                    break;

                case "update": {
                    const existingPattern = existingPatterns.find(p => p.id === result.matchedPatternId);
                    updateSuggestions.push({
                        ...sug,
                        isUpdate: true,
                        existingId: result.matchedPatternId,
                        existingDisplayName: result.matchedPatternDisplayName,
                        oldAmount: existingPattern?.typicalAmount,
                        oldCadence: existingPattern?.cadence,
                        updateReason: result.updateReason,
                    });
                    break;
                }

                case "ambiguous_overlap":
                    // Do NOT default-select these. Return for user review only.
                    ambiguousSuggestions.push({
                        ...sug,
                        isAmbiguous: true,
                        overlapCandidates: result.overlapCandidates,
                    });
                    break;

                case "genuinely_new":
                default:
                    newSuggestions.push(sug);
                    break;
            }
        }

        return NextResponse.json({
            suggestions: newSuggestions,           // genuinely new — may be default-selected
            updateSuggestions,                      // exact match but drifted — offer update
            ambiguousSuggestions,                   // semantic overlap — do NOT default-select
            alreadyRepresentedCount: alreadyRepresented.length,
            totalTransactions: bankTxs.length,
        });
    } catch (error) {
        console.error("Bank detect error:", error);
        return NextResponse.json({ error: "Detection failed" }, { status: 500 });
    }
}
