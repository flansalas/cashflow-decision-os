import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import prisma from "@/db/prisma";
import { POST } from "../route";
import { NextRequest } from "next/server";

vi.mock("@vercel/functions", () => ({
    waitUntil: vi.fn()
}));

let activeRollbackCompanyId = "";

vi.mock("@/services/evaluation-job-worker", async (importOriginal) => {
    const mod = await importOriginal<typeof import("@/services/evaluation-job-worker")>();
    return {
        ...mod,
        triggerEvaluation: vi.fn(async (companyId: string, source: string, sourceId: string, tx: any) => {
            if (companyId === activeRollbackCompanyId) {
                throw new Error("Intentional mock error during evaluation trigger");
            }
            return mod.triggerEvaluation(companyId, source, sourceId, tx);
        })
    };
});
const companyId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb"; // test company

describe("Bank Upload Integration (Isolated)", () => {
    let accountId = "";

    beforeAll(async () => {
        // Create an account for testing
        const acc = await prisma.bankAccount.create({
            data: { id: require("crypto").randomUUID(), companyId, name: "Integration Test Account" }
        });
        accountId = acc.id;
        
        // Clean up before tests
        await prisma.bankTransaction.deleteMany({ where: { companyId } });
        await prisma.bankImportManifest.deleteMany({ where: { companyId } });
        await prisma.evaluationJob.deleteMany({ where: { companyId } });
        await prisma.importBatch.deleteMany({ where: { companyId } });
    });

    afterAll(async () => {
        // Clean up after tests
        await prisma.bankTransaction.deleteMany({ where: { companyId } });
        await prisma.bankImportManifest.deleteMany({ where: { companyId } });
        await prisma.evaluationJob.deleteMany({ where: { companyId } });
        await prisma.importBatch.deleteMany({ where: { companyId } });
        await prisma.bankAccount.delete({ where: { id: accountId } });
        await prisma.$disconnect();
    });

    const mockRequest = (body: any) => {
        return new NextRequest("http://localhost/api/upload/bank", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    };

    it("fails and leaves zero rows if account mapping is missing", async () => {
        const req = mockRequest({
            companyId,
            fileHash: "hash-missing-mapping",
            rows: [
                { date: "2026-08-01", description: "Test 1", amount: -10 }
            ],
            mappingJson: {}
        });

        const res = await POST(req);
        expect(res.status).toBe(400);

        const data = await res.json();
        expect(data.error).toBe("Target bank account mapping is required");

        const txs = await prisma.bankTransaction.count({ where: { companyId } });
        expect(txs).toBe(0);
        
        const jobs = await prisma.evaluationJob.count({ where: { companyId } });
        expect(jobs).toBe(0);
    });

    it("atomically creates manifest, transactions, and evaluation job triggers on success", async () => {
        const fileHash = "hash-success-12345";
        const req = mockRequest({
            companyId,
            accountId,
            fileHash,
            rows: [
                { date: "2026-08-01", description: "Test 1", amount: -10 },
                { date: "2026-08-02", description: "Test 2", amount: -20 },
                { date: "2026-08-03", description: "Test 3", amount: 30 },
                { date: "2026-08-04", description: "Test 4", amount: 40 }
            ],
            mappingJson: {}
        });

        const res = await POST(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.ok).toBe(true);

        // Verify exactly 4 transactions created
        const txs = await prisma.bankTransaction.findMany({ where: { companyId } });
        expect(txs.length).toBe(4);
        expect(txs[0].accountId).toBe(accountId);

        // Verify exactly 1 manifest created
        const manifests = await prisma.bankImportManifest.findMany({ where: { companyId } });
        expect(manifests.length).toBe(1);
        expect(manifests[0].userCertified).toBe(false); // Unverified completeness

        // Verify exactly 1 evaluation job created (or coalesced)
        const jobs = await prisma.evaluationJob.findMany({ where: { companyId } });
        expect(jobs.length).toBe(1);
        expect(["pending", "running"]).toContain(jobs[0].status);

        // Verify trigger points to manifest
        const triggers = await prisma.evaluationJobTrigger.findMany({ where: { companyId } });
        expect(triggers.length).toBe(1);
        expect(triggers[0].source).toBe("bank_upload");
        expect(triggers[0].sourceId).toBe(manifests[0].id);
        expect(triggers[0].evaluationJobId).toBe(jobs[0].id);

        // Test idempotency: retry with same hash should conflict
        const reqRetry = mockRequest({
            companyId,
            accountId,
            fileHash,
            rows: [
                { date: "2026-08-01", description: "Test 1", amount: -10 }
            ],
            mappingJson: {}
        });

        const resRetry = await POST(reqRetry);
        expect(resRetry.status).toBe(409);
        const retryData = await resRetry.json();
        expect(retryData.error).toContain("Duplicate import file");

        // Verify no extra transactions created
        const txsAfter = await prisma.bankTransaction.count({ where: { companyId } });
        expect(txsAfter).toBe(4);
    });
    it("rolls back all rows if triggerEvaluation fails", async () => {
        const rollbackCompanyId = require("crypto").randomUUID();
        activeRollbackCompanyId = rollbackCompanyId;
        await prisma.company.create({ data: { id: rollbackCompanyId, name: "Rollback Test", isDemo: true } });
        const account = await prisma.bankAccount.create({ data: { id: require("crypto").randomUUID(), companyId: rollbackCompanyId, name: "Test Account" } });
        
        const req = mockRequest({
            companyId: rollbackCompanyId,
            accountId: account.id,
            fileHash: "rollback_test_hash",
            rows: [
                { date: "2026-08-01", description: "Test 1", amount: -10 }
            ],
            mappingJson: {}
        });

        // The endpoint catches the error and returns 500
        const res = await POST(req);
        expect(res.status).toBe(500);

        // Assert 1 fallback failed batch created outside the transaction
        const batches = await prisma.importBatch.findMany({ where: { companyId: rollbackCompanyId } });
        expect(batches.length).toBe(1);
        expect(batches[0].status).toBe("failed");

        // Assert 0 rows created inside the transaction
        expect(await prisma.bankImportManifest.count({ where: { companyId: rollbackCompanyId } })).toBe(0);
        expect(await prisma.bankImportManifestAccount.count({ where: { bankAccountId: account.id } })).toBe(0);
        expect(await prisma.bankTransaction.count({ where: { companyId: rollbackCompanyId } })).toBe(0);
        expect(await prisma.evaluationJob.count({ where: { companyId: rollbackCompanyId } })).toBe(0);
        expect(await prisma.evaluationJobTrigger.count({ where: { companyId: rollbackCompanyId } })).toBe(0);

        // Cleanup
        await prisma.bankAccount.delete({ where: { id: account.id } });
        await prisma.company.delete({ where: { id: rollbackCompanyId } });
    });
});
