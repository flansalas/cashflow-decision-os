import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

/**
 * Resolves the correct internal `Company` ID to use for the current request.
 *
 * Flow:
 * 1. Checks for an active Clerk Organization (SaaS Pilot Mode)
 * 2. Falls back to a specific `companyId` query parameter (unauthenticated / legacy mode)
 * 3. Falls back to the most recent non-demo company (ultimate fallback)
 */
export async function resolveTenant(req?: NextRequest): Promise<string | null> {
    let userId: string | null = null;
    let orgId: string | null = null;

    try {
        const auth_result = await auth();
        userId = auth_result.userId ?? null;
        orgId = auth_result.orgId ?? null;
    } catch {
        // auth() can throw outside of a valid Next.js headers context — fall through to URL param
    }

    // ── 1. Active Clerk org — strict lookup, never fall back to URL params ────
    if (orgId) {
        const company = await prisma.company.findUnique({
            where: { clerkOrgId: orgId },
            select: { id: true }
        });

        if (company) return company.id;

        // orgId present but no mapping found — return null rather than leak another tenant's data
        return null;
    }

    // ── 2. Unauthenticated / no active org — honour URL param if present ──────
    if (req) {
        const paramId = req.nextUrl.searchParams.get("companyId");
        if (paramId) return paramId;
    }

    // ── 3. Ultimate fallback — most recent non-demo company ───────────────────
    const fallbackCompany = await prisma.company.findFirst({
        where: { isDemo: false },
        orderBy: { createdAt: "desc" },
    });

    return fallbackCompany?.id ?? null;
}
