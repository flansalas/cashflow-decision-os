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
        userId = auth_result.userId ?? null;
        orgId = auth_result.orgId ?? null;
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
        // Log the DB host so we can confirm which database is being hit
        const dbUrl = process.env.DATABASE_URL ?? "";
        const dbHost = dbUrl.match(/@([^/?]+)/)?.[1] ?? "(unknown)";
        console.log(`SERVER_ORG_ID=${orgId}`);
        console.log(`SERVER_ORG_ID_LEN=${orgId.length}`);
        console.log(`DB_HOST=${dbHost}`);

        // Dump all non-null clerkOrgIds from the DB as individual log lines
        const allCompanies = await prisma.company.findMany({
            where: { clerkOrgId: { not: null } },
            select: { id: true, name: true, clerkOrgId: true }
        });
        console.log(`DB_COMPANY_COUNT_WITH_ORG=${allCompanies.length}`);
        for (const c of allCompanies) {
            const stored = c.clerkOrgId ?? "";
            console.log(`DB_COMPANY_NAME=${c.name}`);
            console.log(`DB_CLERK_ORG_ID=${stored}`);
            console.log(`DB_COMPANY_ID=${c.id}`);
            console.log(`MATCH_EXACT=${stored === orgId}`);
            console.log(`MATCH_TRIMMED=${stored.trim() === orgId.trim()}`);
        }

        // Primary lookup
        const byUnique = await prisma.company.findUnique({
            where: { clerkOrgId: orgId },
            select: { id: true, name: true }
        });
        console.log(`FIND_UNIQUE_RESULT=${byUnique ? byUnique.name : "null"}`);

        if (byUnique) {
            console.log(`[resolveTenant] CASE-C SUCCESS via findUnique -> ${byUnique.name}`);
            return byUnique.id;
        }

        // Fallback lookup
        const byFirst = await prisma.company.findFirst({
            where: { clerkOrgId: orgId },
            select: { id: true, name: true }
        });
        console.log(`FIND_FIRST_RESULT=${byFirst ? byFirst.name : "null"}`);

        if (byFirst) {
            console.log(`[resolveTenant] CASE-C SUCCESS via findFirst -> ${byFirst.name}`);
            return byFirst.id;
        }

        console.log(`CASE_C_FINAL=FAIL_BOTH_NULL`);
        return null;
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
