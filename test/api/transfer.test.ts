import { describe, test, expect, beforeEach, vi, afterAll, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { POST as pairTransfer } from "../../src/app/api/audit/resolve-transfer/route";
import { POST as unpairTransfer } from "../../src/app/api/audit/unresolve-transfer/route";
import prisma from "../../src/db/prisma";

vi.mock("@clerk/nextjs/server", () => ({
    auth: vi.fn(),
}));

import { auth } from "@clerk/nextjs/server";

describe("Internal Transfer API Integration", () => {
    let company: any;
    let otherCompany: any;
    let acc1: any, acc2: any, otherAcc: any;
    let tx1: any, tx2: any, otherTx: any;
    let userId = "user_123";

    beforeAll(async () => {
        await prisma.company.deleteMany({ where: { clerkOrgId: { in: ["org_test_1", "org_test_2"] } } });
        company = await prisma.company.create({ data: { name: "Test Co", clerkOrgId: "org_test_1" } });
        otherCompany = await prisma.company.create({ data: { name: "Other Co", clerkOrgId: "org_test_2" } });

        acc1 = await prisma.bankAccount.create({ data: { companyId: company.id, name: "Acc 1" } });
        acc2 = await prisma.bankAccount.create({ data: { companyId: company.id, name: "Acc 2" } });
        otherAcc = await prisma.bankAccount.create({ data: { companyId: otherCompany.id, name: "Other Acc" } });
    });

    beforeEach(async () => {
        vi.clearAllMocks();
        (auth as any).mockResolvedValue({ userId, orgId: "org_test_1" });
        
        await prisma.bankTransaction.deleteMany();
        await prisma.internalTransferHistory.deleteMany();
        await prisma.evaluationJob.deleteMany();
        await prisma.evaluationJobTrigger.deleteMany();
        await prisma.changeLog.deleteMany();

        tx1 = await prisma.bankTransaction.create({
            data: { companyId: company.id, accountId: acc1.id, txDate: new Date(), amount: 200, description: "T1", direction: "inflow" }
        });
        tx2 = await prisma.bankTransaction.create({
            data: { companyId: company.id, accountId: acc2.id, txDate: new Date(), amount: -200, description: "T2", direction: "outflow" }
        });
        otherTx = await prisma.bankTransaction.create({
            data: { companyId: otherCompany.id, accountId: otherAcc.id, txDate: new Date(), amount: 100, description: "O1", direction: "inflow" }
        });
    });

    afterAll(async () => {
        await prisma.bankTransaction.deleteMany();
        await prisma.internalTransferHistory.deleteMany();
        await prisma.bankAccount.deleteMany();
        await prisma.company.deleteMany();
    });

    function createReq(body: any) {
        return new NextRequest(new URL("http://localhost/api"), {
            method: "POST",
            body: JSON.stringify(body),
        });
    }

    test("authorization - missing auth", async () => {
        (auth as any).mockResolvedValue({ userId: null });
        const res = await pairTransfer(createReq({ txId1: tx1.id, txId2: tx2.id }));
        expect(res.status).toBe(401);
    });

    test("tenant isolation - wrong org", async () => {
        (auth as any).mockResolvedValue({ userId, orgId: "org_99" });
        const res = await pairTransfer(createReq({ txId1: tx1.id, txId2: tx2.id }));
        expect(res.status).toBe(404);
    });
    
    test("tenant isolation - cross company pairing", async () => {
        const res = await pairTransfer(createReq({ txId1: tx1.id, txId2: otherTx.id }));
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("One or both transactions not found or do not belong");
    });

    test("validation - same account", async () => {
        const tx3 = await prisma.bankTransaction.create({
            data: { companyId: company.id, accountId: acc1.id, txDate: new Date(), amount: -200, description: "T3", direction: "outflow" }
        });
        const res = await pairTransfer(createReq({ txId1: tx1.id, txId2: tx3.id }));
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("different accounts");
    });

    test("validation - amounts not equal and opposite", async () => {
        const tx3 = await prisma.bankTransaction.create({
            data: { companyId: company.id, accountId: acc2.id, txDate: new Date(), amount: -199, description: "T3", direction: "outflow" }
        });
        const res = await pairTransfer(createReq({ txId1: tx1.id, txId2: tx3.id }));
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain("Amounts are not equal and opposite");
    });

    test("successful pair creates history, triggers evaluation, updates statuses", async () => {
        const res = await pairTransfer(createReq({ txId1: tx1.id, txId2: tx2.id }));
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.pairId).toBeDefined();

        const t1 = await prisma.bankTransaction.findUnique({ where: { id: tx1.id } });
        const t2 = await prisma.bankTransaction.findUnique({ where: { id: tx2.id } });
        expect(t1?.internalTransferStatus).toBe("confirmed");
        expect(t1?.internalTransferPairId).toBe(data.pairId);
        expect(t2?.internalTransferStatus).toBe("confirmed");

        const history = await prisma.internalTransferHistory.findFirst({ where: { pairId: data.pairId } });
        expect(history).toBeDefined();
        expect(history?.isActive).toBe(true);
        expect(history?.pairedByUserId).toBe(userId);

        const triggers = await prisma.evaluationJobTrigger.findMany({ where: { source: "transfer_paired" } });
        expect(triggers.length).toBe(1);
        
        const logs = await prisma.changeLog.findMany({ where: { source: "resolve-transfer" } });
        expect(logs.length).toBe(1);
    });

    test("concurrency - simultaneous pair attempts only succeed once", async () => {
        const p1 = pairTransfer(createReq({ txId1: tx1.id, txId2: tx2.id }));
        const p2 = pairTransfer(createReq({ txId1: tx1.id, txId2: tx2.id }));
        
        const [r1, r2] = await Promise.all([p1, p2]);
        const jsons = await Promise.all([r1.json(), r2.json()]);
        
        const successCount = jsons.filter(j => j.success).length;
        expect(successCount).toBe(2);
        
        const pairs = jsons.filter(j => j.pairId).map(j => j.pairId);
        expect(pairs[0]).toEqual(pairs[1]);
        
        const histories = await prisma.internalTransferHistory.findMany();
        expect(histories.length).toBe(1); // Only 1 history created
    });

    test("idempotency - repeated pair requests", async () => {
        const r1 = await pairTransfer(createReq({ txId1: tx1.id, txId2: tx2.id }));
        const j1 = await r1.json();
        
        const r2 = await pairTransfer(createReq({ txId1: tx1.id, txId2: tx2.id }));
        const j2 = await r2.json();

        expect(j2.success).toBe(true);
        expect(j2.idempotent).toBe(true);
        expect(j2.pairId).toBe(j1.pairId);

        const histories = await prisma.internalTransferHistory.findMany();
        expect(histories.length).toBe(1);
    });

    test("unpair - successful unpair resets statuses and preserves history", async () => {
        const r1 = await pairTransfer(createReq({ txId1: tx1.id, txId2: tx2.id }));
        const pairId = (await r1.json()).pairId;

        const res = await unpairTransfer(createReq({ pairId }));
        expect(res.status).toBe(200);
        
        const t1 = await prisma.bankTransaction.findUnique({ where: { id: tx1.id } });
        expect(t1?.internalTransferStatus).toBe("unresolved");
        expect(t1?.internalTransferPairId).toBeNull();

        const history = await prisma.internalTransferHistory.findFirst({ where: { pairId } });
        expect(history?.isActive).toBe(false);
        expect(history?.unpairedByUserId).toBe(userId);
        expect(history?.unpairedAt).not.toBeNull();

        const triggers = await prisma.evaluationJobTrigger.findMany({ where: { source: "transfer_unpaired" } });
        expect(triggers.length).toBe(1);
        
        const logs = await prisma.changeLog.findMany({ where: { source: "unresolve-transfer" } });
        expect(logs.length).toBe(1);
    });

    test("idempotency - repeated unpair requests", async () => {
        const r1 = await pairTransfer(createReq({ txId1: tx1.id, txId2: tx2.id }));
        const pairId = (await r1.json()).pairId;

        await unpairTransfer(createReq({ pairId }));
        
        const res2 = await unpairTransfer(createReq({ pairId }));
        const j2 = await res2.json();

        expect(res2.status).toBe(200);
        expect(j2.idempotent).toBe(true);
        
        const triggers = await prisma.evaluationJobTrigger.findMany({ where: { source: "transfer_unpaired" } });
        expect(triggers.length).toBe(1);
    });
});
