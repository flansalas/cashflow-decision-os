// POST /api/upload/bank/patterns
// Bulk-saves approved recurring patterns detected from bank data.
// Skips any pattern whose merchantKey already exists for this company.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

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
}

export async function POST(req: NextRequest) {
    const { companyId, patterns } = await req.json() as {
        companyId: string;
        patterns: ApprovedPattern[];
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!patterns?.length) return NextResponse.json({ saved: 0 });

    try {
        // Check for existing keys to avoid duplicates
        const existing = await prisma.recurringPattern.findMany({
            where: { companyId },
            select: { merchantKey: true },
        });
        const existingKeys = new Set(existing.map(p => p.merchantKey.toLowerCase()));

        const toCreate = patterns.filter(
            p => !existingKeys.has(p.merchantKey.toLowerCase())
        );

        if (toCreate.length === 0) {
            return NextResponse.json({ saved: 0, skipped: patterns.length });
        }

        await prisma.recurringPattern.createMany({
            data: toCreate.map(p => ({
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
            })),
        });

        return NextResponse.json({
            saved: toCreate.length,
            skipped: patterns.length - toCreate.length,
        });
    } catch (error) {
        console.error("Bank patterns save error:", error);
        return NextResponse.json({ error: "Failed to save patterns" }, { status: 500 });
    }
}
