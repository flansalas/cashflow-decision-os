// POST /api/onboarding/start
// Create (or find existing incomplete) non-demo Company. Returns companyId.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function POST(req: NextRequest) {
    const { name } = await req.json() as { name?: string };
    const companyName = (name ?? "").trim() || "My Company";

    try {
        // Check if there's already an incomplete non-demo company
        const existing = await prisma.company.findFirst({
            where: { isDemo: false, onboardingCompleted: false },
            orderBy: { createdAt: "desc" },
        });

        if (existing) {
            return NextResponse.json({
                companyId: existing.id,
                name: existing.name,
                onboardingStep: existing.onboardingStep,
                resumed: true,
            });
        }

        // Create new company
        const company = await prisma.company.create({
            data: {
                name: companyName,
                isDemo: false,
                onboardingCompleted: false,
                onboardingStep: 0,
            },
        });

        return NextResponse.json({
            companyId: company.id,
            name: company.name,
            onboardingStep: 0,
            resumed: false,
        });
    } catch (error) {
        console.error("Onboarding start error:", error);
        return NextResponse.json({ error: "Failed to start onboarding" }, { status: 500 });
    }
}
