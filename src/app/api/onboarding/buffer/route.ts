export const dynamic = 'force-dynamic';
// POST /api/onboarding/buffer
// Step 3: Save bufferMin to Assumption row, advance onboardingStep to 3.
// Tenant authority: derived exclusively from authenticated Clerk organization.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import prisma from "@/db/prisma";

export async function POST(req: NextRequest) {
    const authResult = await auth();
    if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { companyId: bodyCompanyId, bufferMin } = await req.json() as {
        companyId?: string;
        bufferMin: number;
    };

    if (bodyCompanyId && bodyCompanyId !== tenantId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const companyId = tenantId;

    if (typeof bufferMin !== "number" || bufferMin < 0) {
        return NextResponse.json({ error: "Buffer must be a non-negative number" }, { status: 400 });
    }

    try {
        const existing = await prisma.assumption.findFirst({ where: { companyId } });

        if (existing) {
            await prisma.assumption.update({
                where: { id: existing.id },
                data: { bufferMin },
            });
        } else {
            await prisma.assumption.create({
                data: { companyId, bufferMin },
            });
        }

        await prisma.company.update({
            where: { id: companyId },
            data: { onboardingStep: 3 },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Onboarding buffer error:", error);
        return NextResponse.json({ error: "Failed to save buffer" }, { status: 500 });
    }
}
