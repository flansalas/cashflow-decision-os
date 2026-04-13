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
        console.log(`[resolveTenant] auth() call. userId: ${userId}, orgId: ${orgId}`);
        
        // If there IS an active Clerk org, we must strictly use it and never fall back.
        if (orgId) {
            const company = await prisma.company.findUnique({
                where: { clerkOrgId: orgId },
                select: { id: true, name: true }
            });
            
            if (company) {
                console.log(`[resolveTenant] Match SUCCESS. Active Org: ${orgId} -> Company: ${company.name}`);
                
                // If a URL param was passed but an Active Org exists, we loudly ignore the URL param.
                if (req?.nextUrl.searchParams.has("companyId")) {
                    console.log(`[resolveTenant] IGNORING URL param ${req.nextUrl.searchParams.get("companyId")} because Clerk org is active.`);
                }
                
                return company.id;
            } else {
                console.warn(`[resolveTenant] WARNING: Active orgId ${orgId} found, but NO mapping found in database! Blocking fallback to avoid data leaks.`);
                // Return null to force a 404/Empty State rather than leaking another tenant's data via URL fallback.
                return null;
            }
        }
    } catch (e) {
        // auth() might throw if outside of headers context
        console.warn("[resolveTenant] Clerk auth() check failed entirely.", e);
    }

    // 2. Current Live Tester Mode (NO active Clerk org, trusting query params for now)
    if (req) {
        const paramId = req.nextUrl.searchParams.get("companyId");
        if (paramId) {
            console.log(`[resolveTenant] NO active Clerk org. Honoring URL param companyId: ${paramId}`);
            return paramId;
        }
    }

    // 3. Fallback to the latest active company (as it worked previously)
    const fallbackCompany = await prisma.company.findFirst({
        where: { isDemo: false },
        orderBy: { createdAt: "desc" },
    });

    return fallbackCompany?.id ?? null;
}
