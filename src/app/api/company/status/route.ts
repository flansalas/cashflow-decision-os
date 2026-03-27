// GET /api/company/status?companyId=xxx
// Returns onboarding status for the given company (or the most recent non-demo company).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function GET(req: NextRequest) {
    const companyId = req.nextUrl.searchParams.get("companyId");

    try {
        let company;
        if (companyId) {
            company = await prisma.company.findUnique({ where: { id: companyId } });
        } else {
            company = await prisma.company.findFirst({
                where: { isDemo: false },
                orderBy: { createdAt: "desc" },
            });
        }

        if (!company) {
            return NextResponse.json({ exists: false });
        }

        return NextResponse.json({
            exists: true,
            companyId: company.id,
            name: company.name,
            onboardingCompleted: company.onboardingCompleted,
            onboardingStep: company.onboardingStep,
        });
    } catch (error) {
        console.error("Company status error:", error);
        return NextResponse.json({ error: "Failed to get company status" }, { status: 500 });
    }
}
