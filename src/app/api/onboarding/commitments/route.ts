export const dynamic = 'force-dynamic';
// POST /api/onboarding/commitments
// Step 4: Save 0-5 recurring outflow commitments, advance onboardingStep to 4.
// Tenant authority: derived exclusively from authenticated Clerk organization.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

interface CommitmentInput {
    name: string;
    cadence: string;
    amount: number;
    nextDate: string;
    isCritical: boolean;
}

export async function POST(req: NextRequest) {
    const authResult = await auth();
    if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { companyId: bodyCompanyId, commitments } = await req.json() as {
        companyId?: string;
        commitments: CommitmentInput[];
    };

    if (bodyCompanyId && bodyCompanyId !== tenantId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const companyId = tenantId;

    const valid = (commitments ?? []).filter(
        c => c.name?.trim() && c.amount > 0 && c.nextDate
    ).slice(0, 5);

    try {
        if (valid.length > 0) {
            // Delete existing manual commitments to avoid duplicates on re-onboarding
            await prisma.recurringPattern.deleteMany({
                where: { companyId, category: "other" }
            });

            await prisma.recurringPattern.createMany({
                data: valid.map(c => ({
                    id: uuidv4(),
                    companyId,
                    direction: "outflow",
                    merchantKey: c.name.trim().toLowerCase().replace(/\s+/g, "_"),
                    displayName: c.name.trim(),
                    typicalAmount: c.amount,
                    amountStdDev: 0,
                    cadence: c.cadence ?? "monthly",
                    nextExpectedDate: new Date(c.nextDate),
                    confidence: "med",
                    category: "other",
                    isIncluded: true,
                    isCritical: c.isCritical ?? false,
                })),
            });
        }

        await prisma.company.update({
            where: { id: companyId },
            data: { onboardingStep: 4 },
        });

        return NextResponse.json({ ok: true, saved: valid.length });
    } catch (error) {
        console.error("Onboarding commitments error:", error);
        return NextResponse.json({ error: "Failed to save commitments" }, { status: 500 });
    }
}
