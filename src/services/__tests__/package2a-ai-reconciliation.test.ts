import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { proposeReconciliations } from "../ai-reconciliation";
import prisma from "../../db/prisma";

vi.mock("@clerk/nextjs/server", () => {
    return {
        auth: () => ({ userId: "u_test_123" })
    };
});

describe("Package 2A - AI Reconciliation Authority", () => {
    const companyId = "c_ai_test_" + Date.now();
    let entryId = "";
    let targetId = "";

    beforeAll(async () => {
        await prisma.company.create({
            data: { id: companyId, name: "AI Test Tenant", clerkOrgId: "org_" + companyId }
        });
        const target = await prisma.receivableInvoice.create({
            data: {
                companyId,
                invoiceNo: "INV-AI-TEST",
                customerName: "AI Corp",
                amountOpen: 500,
                status: "open",
                dueDate: new Date()
            }
        });
        targetId = target.id;

        const category = await prisma.cashFlowCategory.create({
            data: { companyId, name: "Test Category", direction: "inflow" }
        });
        const entry = await prisma.cashFlowEntry.create({
            data: {
                companyId,
                amount: 500,
                targetDate: new Date(),
                label: "Payment from AI Corp",
                categoryId: category.id
            }
        });
        entryId = entry.id;
    });

    afterAll(async () => {
        await prisma.reconciliationLink.deleteMany({ where: { companyId } });
        await prisma.cashFlowEntry.deleteMany({ where: { companyId } });
        await prisma.receivableInvoice.deleteMany({ where: { companyId } });
        await prisma.company.deleteMany({ where: { id: companyId } });
    });

    it("creates AI proposals as pending (deductFrom = null)", async () => {
        // Run AI proposer
        await proposeReconciliations(companyId);

        // Verify the link
        const link = await prisma.reconciliationLink.findFirst({
            where: { companyId, sourceId: entryId, targetId: targetId }
        });

        // Even though it's an exact match on amount and date, it MUST be pending
        expect(link).toBeDefined();
        if (!link) throw new Error("Link not created");

        expect(link.matchMethod).toBe("ai");
        expect(link.deductFrom).toBeNull();
    });
});
