import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as cashPost } from "../onboarding/cash/route";
import { POST as bankPost } from "../upload/bank/route";
import { POST as patternsPost } from "../upload/bank/patterns/route";
import prisma from "../../../db/prisma";

let mockUserId: string | null = "u_test_123";

vi.mock("@clerk/nextjs/server", () => ({
    auth: () => ({ userId: mockUserId })
}));

describe("Package 2A - Tenancy Boundary", () => {
    const validCompanyId = "c_tenant_test_" + Date.now();

    beforeAll(async () => {
        await prisma.company.create({
            data: {
                id: validCompanyId,
                name: "Test Tenant",
                clerkOrgId: "org_test_" + validCompanyId
            }
        });
    });

    afterAll(async () => {
        await prisma.company.deleteMany({ where: { id: validCompanyId } });
    });

    afterEach(() => {
        mockUserId = "u_test_123";
    });

    it("rejects onboarding/cash when unauthenticated", async () => {
        mockUserId = null; // Unauthenticated

        const req = new NextRequest("http://localhost/api/onboarding/cash", {
            method: "POST",
            body: JSON.stringify({ companyId: validCompanyId, balance: 1000 })
        });
        const res = await cashPost(req);
        expect(res.status).toBe(401);
    });

    it("rejects requests if body companyId differs from resolved tenantId", async () => {
        const evilCompanyId = "c_evil_corp_123";
        const req = new NextRequest("http://localhost/api/onboarding/cash", {
            method: "POST",
            headers: { "x-tenant-id": validCompanyId },
            body: JSON.stringify({ companyId: evilCompanyId, balance: 1000 })
        });
        const res = await cashPost(req);
        expect(res.status).toBe(403);
    });

    it("bank route removes fallback to body companyId without tenantId", async () => {
        const req = new NextRequest("http://localhost/api/upload/bank", {
            method: "POST",
            body: JSON.stringify({ companyId: validCompanyId, rows: [], mappingJson: {} })
        });
        const res = await bankPost(req);
        expect(res.status).toBe(401);
    });

    it("bank patterns rejects cross-tenant pattern mutation", async () => {
        const evilPattern = await prisma.recurringPattern.create({
            data: {
                id: "pat_evil_123",
                companyId: "c_other_tenant",
                merchantKey: "STEAL_ME",
                direction: "outflow",
                displayName: "Evil Pattern",
                typicalAmount: 100,
                cadence: "monthly",
                category: "Evil"
            }
        });

        const req = new NextRequest("http://localhost/api/upload/bank/patterns", {
            method: "POST",
            headers: { "x-tenant-id": validCompanyId },
            body: JSON.stringify({ companyId: validCompanyId, toUpdate: [{ existingId: evilPattern.id, category: "Hacked" }] })
        });
        const res = await patternsPost(req);
        
        // Either 403 or silently ignored
        expect(res.status).toBe(200);

        const reloaded = await prisma.recurringPattern.findUnique({ where: { id: evilPattern.id } });
        expect(reloaded?.category).toBe("Evil");

        await prisma.recurringPattern.delete({ where: { id: evilPattern.id } });
    });
});
