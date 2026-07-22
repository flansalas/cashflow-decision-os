export const dynamic = 'force-dynamic';
// POST /api/onboarding/start
// Create (or find existing incomplete) non-demo Company. Returns companyId.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
    const { name } = await req.json() as { name?: string };
    const companyName = (name ?? "").trim() || "My Company";

    try {
        const auth_result = await auth().catch(() => ({ orgId: null }));
        const orgId = auth_result.orgId;

        if (!orgId) {
            return NextResponse.json({ error: "Active organization required for onboarding" }, { status: 400 });
        }
        // Check if there's already an incomplete non-demo company
        const existing = await prisma.company.findFirst({
            where: { isDemo: false, onboardingCompleted: false, clerkOrgId: orgId },
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
                clerkOrgId: orgId,
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
