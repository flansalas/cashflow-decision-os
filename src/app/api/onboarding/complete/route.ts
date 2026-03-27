// POST /api/onboarding/complete
// Step 5: Mark onboarding complete. If mismatchUnreconciled, store CompanyNote for confidence penalty.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function POST(req: NextRequest) {
    const { companyId, mismatchUnreconciled } = await req.json() as {
        companyId: string;
        mismatchUnreconciled?: boolean;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

    try {
        // If reality check was skipped/failed, record a note for QA confidence penalty
        if (mismatchUnreconciled) {
            // Remove any existing mismatch note first
            await prisma.companyNote.deleteMany({
                where: { companyId, noteText: "cash_mismatch_unreconciled" },
            });
            await prisma.companyNote.create({
                data: { companyId, noteText: "cash_mismatch_unreconciled" },
            });
        } else {
            // Clear any previous mismatch note if user reconciled
            await prisma.companyNote.deleteMany({
                where: { companyId, noteText: "cash_mismatch_unreconciled" },
            });
        }

        await prisma.company.update({
            where: { id: companyId },
            data: { onboardingCompleted: true, onboardingStep: 5 },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Onboarding complete error:", error);
        return NextResponse.json({ error: "Failed to complete onboarding" }, { status: 500 });
    }
}
