import { NextRequest } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

/**
 * Resolves the correct internal `Company` ID for the current request.
 *
 * Flow:
 * 1. Active Clerk org → strict clerkOrgId lookup (authenticated SaaS mode)
 * 2. Authenticated but no active org → fallback to first organization membership
 * 3. Authenticated but no memberships → null (prevent silent fallback to demo)
 * 4. Explicit `companyId` URL param → direct lookup (unauthenticated legacy mode)
 * 5. No match → null (no fallback to "most recent company" — prevents tenant data leaks)
 */
export async function resolveTenant(req?: NextRequest): Promise<string | null> {
    let orgId: string | null = null;
    let userId: string | null = null;

    try {
        const auth_result = await auth();
        userId = auth_result.userId ?? null;
        orgId = auth_result.orgId ?? null;
    } catch {
        // auth() can throw outside of a valid Next.js headers context
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

    // ── 2. No active org → null ─────────────────────────
    // URL fallback and unauthenticated legacy modes are explicitly disabled.
    return null;
}

