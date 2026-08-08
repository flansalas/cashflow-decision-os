// Tests for the patterns save endpoint guard.
// Covers: test cases 1 (exact dup), 7 (direct submission to save endpoint),
// 18 (idempotent re-import), 19 (tenant isolation).

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock Prisma and Auth ──────────────────────────────────────────────────────

vi.mock("@/db/prisma", () => ({
    default: {
        recurringPattern: {
            findMany: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
        },
    },
}));

vi.mock("@clerk/nextjs/server", () => ({
    auth: vi.fn().mockResolvedValue({ userId: "test-user-123" }),
}));

vi.mock("@/lib/tenant", () => ({
    resolveTenant: vi.fn().mockResolvedValue("company-abc"),
}));

import prisma from "@/db/prisma";
import { POST } from "@/app/api/upload/bank/patterns/route";
import { NextRequest } from "next/server";

function makeRequest(body: object, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest("http://localhost/api/upload/bank/patterns", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", ...headers },
    });
}

const existingPatterns = [
    {
        id: "pat-sba",
        merchantKey: "sba loan",
        displayName: "SBA Loan",
        typicalAmount: 3887,
        cadence: "monthly",
        direction: "outflow",
        category: "loan",
        isIncluded: true,
    },
    {
        id: "pat-ford-utility",
        merchantKey: "ford 22' utility body",
        displayName: "Ford 22' Utility Body",
        typicalAmount: 1229,
        cadence: "monthly",
        direction: "outflow",
        category: "loan",
        isIncluded: true,
    },
];

function makePattern(overrides: Partial<{
    merchantKey: string; displayName: string; typicalAmount: number;
    cadence: string; category: string; isCritical: boolean; nextExpectedDate: string;
}> = {}) {
    return {
        merchantKey: "genuinely-new-item",
        displayName: "Genuinely New Item",
        typicalAmount: 500,
        cadence: "monthly",
        amountStdDev: 0,
        confidence: "high",
        nextExpectedDate: "2026-09-01T00:00:00Z",
        category: "other",
        isCritical: false,
        ...overrides,
    };
}

describe("patterns save endpoint — server-side economic duplicate guard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.recurringPattern.findMany as any).mockResolvedValue(existingPatterns);
        (prisma.recurringPattern.create as any).mockResolvedValue({ id: "new-id" });
        (prisma.recurringPattern.update as any).mockResolvedValue({});
    });

    // ── Test 1: Exact duplicate submitted directly → rejected ──────────────

    it("1 & 7. exact key duplicate submitted directly to save endpoint → skippedAlreadyRepresented", async () => {
        const req = makeRequest({
            companyId: "company-abc",
            patterns: [makePattern({ merchantKey: "sba loan", displayName: "SBA Loan", typicalAmount: 3887, cadence: "monthly" })],
        });
        const response = await POST(req);
        const data = await response.json();

        expect(data.skippedAlreadyRepresented).toBe(1);
        expect(data.created).toBe(0);
        expect(prisma.recurringPattern.create).not.toHaveBeenCalled();
    });

    // ── Test 2: Semantic duplicate → skippedAmbiguous ─────────────────────

    it("7b. semantic/name-variant duplicate submitted directly → skippedAmbiguous", async () => {
        const req = makeRequest({
            companyId: "company-abc",
            patterns: [makePattern({
                merchantKey: "sba",
                displayName: "SBA",
                typicalAmount: 3887,
                cadence: "monthly",
                category: "loan",
            })],
        });
        const response = await POST(req);
        const data = await response.json();

        expect(data.skippedAmbiguous).toBe(1);
        expect(data.created).toBe(0);
        expect(prisma.recurringPattern.create).not.toHaveBeenCalled();
    });

    // ── Test 3: Genuinely new → created ────────────────────────────────────

    it("genuinely new pattern → created", async () => {
        const req = makeRequest({
            companyId: "company-abc",
            patterns: [makePattern()],
        });
        const response = await POST(req);
        const data = await response.json();

        expect(data.created).toBe(1);
        expect(data.skippedAlreadyRepresented).toBe(0);
        expect(data.skippedAmbiguous).toBe(0);
        expect(prisma.recurringPattern.create).toHaveBeenCalledOnce();
    });

    // ── Test 4: Mixed batch ────────────────────────────────────────────────

    it("mixed batch: one exact dup, one ambiguous, one genuine → only genuine created", async () => {
        const req = makeRequest({
            companyId: "company-abc",
            patterns: [
                makePattern({ merchantKey: "sba loan", displayName: "SBA Loan", typicalAmount: 3887, cadence: "monthly" }),
                makePattern({ merchantKey: "sba", displayName: "SBA", typicalAmount: 3887, cadence: "monthly" }),
                // Genuinely new: completely different name/amount with zero token overlap to existing patterns
                makePattern({ merchantKey: "allied portables llc", displayName: "Allied Portables LLC", typicalAmount: 96, cadence: "monthly", category: "other" }),
            ],
        });
        const response = await POST(req);
        const data = await response.json();

        expect(data.created).toBe(1);
        expect(data.skippedAlreadyRepresented).toBe(1);
        expect(data.skippedAmbiguous).toBe(1);
        expect(prisma.recurringPattern.create).toHaveBeenCalledOnce();
    });


    // ── Test 5: Idempotent re-import (test 18) ────────────────────────────

    it("18. submitting the same genuinely-new pattern twice is idempotent (second call skips)", async () => {
        // Simulate that the pattern was already created in a prior upload:
        // findMany returns existing patterns PLUS the previously created one.
        (prisma.recurringPattern.findMany as any).mockResolvedValue([
            ...existingPatterns,
            {
                id: "new-allied",
                merchantKey: "allied portables llc",
                displayName: "Allied Portables LLC",
                typicalAmount: 96,
                cadence: "monthly",
                direction: "outflow",
                category: "other",
                isIncluded: true,
            },
        ]);

        // Second submission of the same pattern should be rejected as already_represented
        const req2 = makeRequest({
            companyId: "company-abc",
            patterns: [makePattern({
                merchantKey: "allied portables llc",
                displayName: "Allied Portables LLC",
                typicalAmount: 96,
                cadence: "monthly",
            })],
        });
        const response2 = await POST(req2);
        const data2 = await response2.json();

        expect(data2.created).toBe(0);
        expect(data2.skippedAlreadyRepresented).toBe(1);
        expect(prisma.recurringPattern.create).not.toHaveBeenCalled();
    });


    // ── Test 6: Tenant isolation (test 19) ────────────────────────────────

    it("19. body companyId that differs from authenticated tenant → 403 Forbidden", async () => {
        // resolveTenant returns "company-abc" but body has a different companyId
        const req = makeRequest({
            companyId: "company-EVIL-OTHER-TENANT",
            patterns: [makePattern()],
        });
        const response = await POST(req);
        expect(response.status).toBe(403);
        expect(prisma.recurringPattern.create).not.toHaveBeenCalled();
    });

    it("19b. unauthenticated request (no userId) → 401", async () => {
        const { auth } = await import("@clerk/nextjs/server");
        (auth as any).mockResolvedValueOnce({ userId: null });

        const req = makeRequest({
            companyId: "company-abc",
            patterns: [makePattern()],
        });
        const response = await POST(req);
        expect(response.status).toBe(401);
    });

    it("19c. resolveTenant fails → 401", async () => {
        const { resolveTenant } = await import("@/lib/tenant");
        (resolveTenant as any).mockResolvedValueOnce(null);

        const req = makeRequest({
            companyId: "company-abc",
            patterns: [makePattern()],
        });
        const response = await POST(req);
        expect(response.status).toBe(401);
    });
});
