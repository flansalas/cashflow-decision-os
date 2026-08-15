import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as bankPost } from "../../app/api/upload/bank/route";
import { POST as applyPost } from "../../app/api/upload/apply/route";
import prisma from "../../db/prisma";

vi.mock("@clerk/nextjs/server", () => ({
    auth: () => ({ userId: "u_test_123" })
}));

vi.mock("@vercel/functions", () => ({
    waitUntil: (p: any) => Promise.resolve()
}));

vi.mock("../../services/ai-reconciliation", () => ({
    proposeReconciliations: vi.fn().mockResolvedValue(true)
}));

describe("Package 2A - Bank Authority", () => {
    const companyId = "c_bank_test_" + Date.now();

    beforeAll(async () => {
        await prisma.company.create({
            data: { id: companyId, name: "Bank Test Tenant", clerkOrgId: "org_" + companyId }
        });
        
        await prisma.mappingProfile.upsert({
            where: { companyId_kind: { companyId, kind: "bank" } },
            update: {},
            create: { companyId, kind: "bank", mappingJson: "{}" }
        });
    });

    afterAll(async () => {
        await prisma.importApplyChange.deleteMany({ where: { companyId } });
        await prisma.importApplication.deleteMany({ where: { companyId } });
        await prisma.changeLog.deleteMany({ where: { companyId } });
        await prisma.bankTransaction.deleteMany({ where: { companyId } });
        await prisma.importBatch.deleteMany({ where: { companyId } });
        await prisma.mappingProfile.deleteMany({ where: { companyId } });
        await prisma.company.deleteMany({ where: { id: companyId } });
    });

    it("bank upload auto-applies and prevents re-application", async () => {
        const rows = [
            { date: "2024-01-01", description: "Test Vendor", amount: -100, direction: "outflow", ordinal: 1 }
        ];

        const req = new NextRequest("http://localhost/api/upload/bank", {
            method: "POST",
            headers: { "x-tenant-id": companyId },
            body: JSON.stringify({ companyId, rows, mappingJson: {} })
        });
        
        const res = await bankPost(req);
        const data = await res.json();
        
        expect(res.status).toBe(200);
        expect(data.batchId).toBeDefined();

        // Check that batch is applied
        const batch = await prisma.importBatch.findUnique({ where: { id: data.batchId } });
        expect(batch?.status).toBe("applied");

        // Check that Application evidence was created
        const appRecord = await prisma.importApplication.findFirst({ where: { importBatchId: data.batchId } });
        expect(appRecord).toBeDefined();
        expect(appRecord?.insertedCount).toBe(1);

        // Attempt to apply it again via apply route
        const applyReq = new NextRequest("http://localhost/api/upload/apply", {
            method: "POST",
            headers: { "x-tenant-id": companyId },
            body: JSON.stringify({ importBatchId: data.batchId })
        });
        
        const applyRes = await applyPost(applyReq);
        expect(applyRes.status).toBe(400);
        const applyData = await applyRes.json();
        expect(applyData.error).toBe("already_applied");
    });
});
