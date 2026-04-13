import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

/**
 * Resolves the correct internal `Company` ID to use for the current request.
 * 
 * Flow:
 * 1. Checks for an active Clerk Organization (SaaS Pilot Mode)
 * 2. Falls back to a specific `companyId` query parameter (Current Live Tester Mode)
 * 3. Falls back to the most recent non-demo company (Ultimate Fallback)
 */
export async function resolveTenant(req?: NextRequest): Promise<string | null> {
    try {
        // 1. Clerk SaaS Pilot Mode
        const { orgId, userId } = await auth();
        console.log(`[resolveTenant] auth() call complete. userId: ${userId}, orgId: ${orgId}`);
        if (orgId) {
            const company = await prisma.company.findUnique({
                where: { clerkOrgId: orgId },
                select: { id: true, name: true }
            });
            if (company) {
                console.log(`[resolveTenant] Match found passing Cascio: DB ID = ${company.id}, Name = ${company.name}`);
                return company.id;
            } else {
                console.log(`[resolveTenant] orgId ${orgId} found in Clerk session, but NO mapping found in Prisma database.`);
            }
        }
    } catch (e) {
        // auth() might throw if used improperly or outside of Next headers context, we catch to safely fallback
        console.warn("[resolveTenant] Clerk auth() check failed, falling back to legacy manual tenant resolution.", e);
    }

    // 2. Current Live Tester Mode (unauthenticated, trusting query params for now)
    if (req) {
        const paramId = req.nextUrl.searchParams.get("companyId");
        console.log(`[resolveTenant] Falling back to URL param companyId: ${paramId}`);
        if (paramId) return paramId;
    }

    // 3. Fallback to the latest active company (as it worked previously)
    const fallbackCompany = await prisma.company.findFirst({
        where: { isDemo: false },
        orderBy: { createdAt: "desc" },
    });

    return fallbackCompany?.id ?? null;
}
