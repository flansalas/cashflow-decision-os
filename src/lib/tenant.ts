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
    const path = req?.nextUrl.pathname ?? "(no-req)";

    let userId: string | null = null;
    let orgId: string | null = null;

    try {
        const auth_result = await auth();
        userId = auth_result.userId;
        orgId = auth_result.orgId;
    } catch (e) {
        console.error(`[resolveTenant][${path}] CASE-A: auth() threw — session completely unreadable.`, e);
        // Fall through to URL param / fallback
    }

    // ── Classify the request immediately ──────────────────────────────────────
    if (!userId && !orgId) {
        console.log(`[resolveTenant][${path}] CASE-A userId=null orgId=null — unauthenticated request`);
    } else if (userId && !orgId) {
        console.log(`[resolveTenant][${path}] CASE-B userId=${userId} orgId=null — signed in but NO active org on session token`);
    } else if (userId && orgId) {
        console.log(`[resolveTenant][${path}] CASE-C userId=${userId} orgId=${orgId} — fully authenticated with org`);
    }

    // ── CASE C: org present — strict lookup, never fall back ──────────────────
    if (orgId) {
        const company = await prisma.company.findUnique({
            where: { clerkOrgId: orgId },
            select: { id: true, name: true }
        });
        if (company) {
            console.log(`[resolveTenant][${path}] CASE-C SUCCESS: orgId=${orgId} -> "${company.name}" (id=${company.id})`);
            return company.id;
        } else {
            console.error(`[resolveTenant][${path}] CASE-C FAIL: orgId=${orgId} found in session, NO company row with that clerkOrgId. Returning null (no data leak).`);
            return null; // Hard stop — never leak another tenant's data
        }
    }

    // ── CASE A/B fallback: no org on session — use URL param if present ───────
    if (req) {
        const paramId = req.nextUrl.searchParams.get("companyId");
        if (paramId) {
            console.log(`[resolveTenant][${path}] CASE-${userId ? "B" : "A"} FALLBACK: no org on session, using URL param companyId=${paramId}`);
            return paramId;
        }
    }

    // ── Ultimate fallback (no URL param either) ────────────────────────────────
    const fallbackCompany = await prisma.company.findFirst({
        where: { isDemo: false },
        orderBy: { createdAt: "desc" },
    });
    console.log(`[resolveTenant][${path}] CASE-${userId ? "B" : "A"} ULTIMATE FALLBACK: returning company "${fallbackCompany?.name}" (id=${fallbackCompany?.id})`);
    return fallbackCompany?.id ?? null;
}
