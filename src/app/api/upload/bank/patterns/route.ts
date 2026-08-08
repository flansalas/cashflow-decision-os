// POST /api/upload/bank/patterns
// Bulk-saves approved recurring patterns detected from bank data.
// Server-side guard: refuses to create economic duplicates even if the
// client submits them. Uses classifyDetectedPattern() for multi-signal
// economic identity matching — not just exact merchantKey equality.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import { classifyDetectedPattern } from "@/services/detectPatterns";

interface ApprovedPattern {
    merchantKey: string;
    displayName: string;
    cadence: string;
    typicalAmount: number;
    amountStdDev: number;
    confidence: string;
    nextExpectedDate: string;   // ISO date string
    category: string;
    isCritical: boolean;
    isUpdate?: boolean;
    existingId?: string;
}

export async function POST(req: NextRequest) {
    const authResult = await auth();
    if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { companyId: bodyCompanyId, patterns } = await req.json() as {
        companyId?: string;
        patterns: ApprovedPattern[];
    };

    if (bodyCompanyId && bodyCompanyId !== tenantId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const companyId = tenantId;

    if (!patterns?.length) return NextResponse.json({ saved: 0, created: 0, updated: 0, skippedAlreadyRepresented: 0, skippedAmbiguous: 0 });

    try {
        const toUpdate = patterns.filter(p => p.isUpdate && p.existingId);
        const toCreate = patterns.filter(p => !p.isUpdate);

        // ── 1. Process Updates (exact id match — safe, no duplication risk) ──
        let updated = 0;
        for (const p of toUpdate) {
            await prisma.recurringPattern.update({
                where: { id: p.existingId! },
                data: {
                    typicalAmount: p.typicalAmount,
                    amountStdDev: p.amountStdDev,
                    cadence: p.cadence,
                    nextExpectedDate: new Date(p.nextExpectedDate),
                    confidence: p.confidence,
                },
            });
            updated++;
        }

        // ── 2. Process Creates — server-side economic duplicate guard ─────────
        // Fetch all existing patterns for this company to run the full
        // classifyDetectedPattern() check — not just merchantKey equality.
        const existing = await prisma.recurringPattern.findMany({
            where: { companyId },
            select: { id: true, merchantKey: true, displayName: true, typicalAmount: true, cadence: true, direction: true, category: true, isIncluded: true },
        });

        let created = 0;
        let skippedAlreadyRepresented = 0;
        let skippedAmbiguous = 0;

        for (const p of toCreate) {
            const result = classifyDetectedPattern(
                {
                    merchantKey: p.merchantKey,
                    displayName: p.displayName,
                    typicalAmount: p.typicalAmount,
                    cadence: p.cadence,
                    direction: "outflow",
                },
                existing
            );

            if (result.classification === "already_represented") {
                console.warn(
                    `[patterns/save] Skipping already_represented: ${p.displayName} ` +
                    `(matches existing: ${result.matchedPatternDisplayName})`
                );
                skippedAlreadyRepresented++;
                continue;
            }

            if (result.classification === "ambiguous_overlap") {
                console.warn(
                    `[patterns/save] Skipping ambiguous_overlap: ${p.displayName} ` +
                    `(overlaps: ${result.overlapCandidates?.map(c => c.displayName).join(", ")})`
                );
                skippedAmbiguous++;
                continue;
            }

            // "genuinely_new" — safe to create
            // Final exact key guard as backstop
            const exactKeyExists = existing.some(
                e => e.merchantKey.toLowerCase() === p.merchantKey.toLowerCase()
            );
            if (exactKeyExists) {
                skippedAlreadyRepresented++;
                continue;
            }

            await prisma.recurringPattern.create({
                data: {
                    id: uuidv4(),
                    companyId,
                    direction: "outflow",
                    merchantKey: p.merchantKey,
                    displayName: p.displayName,
                    typicalAmount: p.typicalAmount,
                    amountStdDev: p.amountStdDev,
                    cadence: p.cadence,
                    nextExpectedDate: new Date(p.nextExpectedDate),
                    confidence: p.confidence,
                    category: p.category,
                    isIncluded: true,
                    isCritical: p.isCritical,
                },
            });

            // Add to local copy so subsequent patterns in the same batch also see it
            existing.push({
                id: "pending",
                merchantKey: p.merchantKey,
                displayName: p.displayName,
                typicalAmount: p.typicalAmount,
                cadence: p.cadence,
                direction: "outflow",
                category: p.category,
                isIncluded: true,
            });
            created++;
        }

        return NextResponse.json({
            saved: created + updated,
            created,
            updated,
            skippedAlreadyRepresented,
            skippedAmbiguous,
        });
    } catch (error) {
        console.error("Bank patterns save error:", error);
        return NextResponse.json({ error: "Failed to save patterns" }, { status: 500 });
    }
}
