// POST /api/onboarding/buffer
// Step 3: Save bufferMin to Assumption row, advance onboardingStep to 3.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function POST(req: NextRequest) {
    const { companyId, bufferMin } = await req.json() as {
        companyId: string;
        bufferMin: number;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
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
