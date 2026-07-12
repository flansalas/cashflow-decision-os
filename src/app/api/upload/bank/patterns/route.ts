// POST /api/upload/bank/patterns
// Bulk-saves approved recurring patterns detected from bank data.
// Skips any pattern whose merchantKey already exists for this company.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";

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

    if (!patterns?.length) return NextResponse.json({ saved: 0 });

    try {
        const toCreate = patterns.filter(p => !p.isUpdate);
        const toUpdate = patterns.filter(p => p.isUpdate && p.existingId);

        // 1. Process Updates
        for (const p of toUpdate) {
            await prisma.recurringPattern.update({
                where: { id: p.existingId! },
                data: {
                    typicalAmount: p.typicalAmount,
                    amountStdDev: p.amountStdDev,
                    cadence: p.cadence,
                    nextExpectedDate: new Date(p.nextExpectedDate),
                    confidence: p.confidence,
                }
            });
        }

        // 2. Process Creates
        if (toCreate.length > 0) {
            // Extra check to prevent duplicate inserts just in case
            const existing = await prisma.recurringPattern.findMany({
                where: { companyId },
                select: { merchantKey: true },
            });
            const existingKeys = new Set(existing.map(p => p.merchantKey.toLowerCase()));

            const safeToCreate = toCreate.filter(p => !existingKeys.has(p.merchantKey.toLowerCase()));

            if (safeToCreate.length > 0) {
                await prisma.recurringPattern.createMany({
                    data: safeToCreate.map(p => ({
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
            }
        }

        return NextResponse.json({
            saved: toCreate.length + toUpdate.length,
            created: toCreate.length,
            updated: toUpdate.length,
        });
    } catch (error) {
        console.error("Bank patterns save error:", error);
        return NextResponse.json({ error: "Failed to save patterns" }, { status: 500 });
    }
}
