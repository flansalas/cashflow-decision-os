import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

/**
 * Resolves the correct internal `Company` ID for the current request.
 *
 * Flow:
 * 1. Active Clerk org → strict clerkOrgId lookup (authenticated SaaS mode)
 * 2. Explicit `companyId` URL param → direct lookup (unauthenticated legacy mode)
 * 3. No match → null (no fallback to "most recent company" — prevents tenant data leaks)
 */
export async function resolveTenant(req?: NextRequest): Promise<string | null> {
    let orgId: string | null = null;

    try {
        const auth_result = await auth();
        orgId = auth_result.orgId ?? null;
    } catch {
        // auth() can throw outside of a valid Next.js headers context — fall through to URL param
    }

    // ── 1. Active Clerk org — strict lookup only ──────────────────────────────
    if (orgId) {
        const company = await prisma.company.findUnique({
            where: { clerkOrgId: orgId },
            select: { id: true }
        });

        // orgId present but no mapping → return null rather than leak another tenant's data
        return company?.id ?? null;
    }

    // ── 2. Unauthenticated: honour explicit URL param if present ──────────────
    if (req) {
        const paramId = req.nextUrl.searchParams.get("companyId");
        if (paramId) return paramId;
    }

    // ── 3. No session, no param → null. Never fall back to "most recent company" ─
    return null;
}

