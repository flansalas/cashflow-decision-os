import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as arPost } from "../../app/api/upload/ar/route";
import prisma from "../../db/prisma";

vi.mock("@clerk/nextjs/server", () => ({
    auth: () => ({ userId: "u_test_123" })
}));

describe("Package 2A - AR/AP Staging Pipeline", () => {
    const companyId = "c_arap_test_" + Date.now();

    beforeAll(async () => {
        await prisma.company.create({
            data: { id: companyId, name: "ARAP Test Tenant", clerkOrgId: "org_" + companyId }
        });
        await prisma.receivableInvoice.create({
            data: {
                companyId,
                invoiceNo: "INV-EXISTING",
                customerName: "Old Corp",
                amountOpen: 1000,
                status: "open"
            }
        });
        await prisma.receivableInvoice.create({
            data: {
                companyId,
                invoiceNo: "INV-HIDDEN",
                customerName: "Hidden Corp",
                amountOpen: 500,
                status: "open"
            }
        });
    });

    afterAll(async () => {
        await prisma.stagedImportRow.deleteMany({ where: { companyId } });
        await prisma.importBatch.deleteMany({ where: { companyId } });
        await prisma.receivableInvoice.deleteMany({ where: { companyId } });
        await prisma.company.deleteMany({ where: { id: companyId } });
    });

    it("stages rows correctly according to conflict logic", async () => {
        const rows = [
            { invoiceNo: "INV-NEW", customerName: "New Corp", amountOpen: 100, status: "open", daysPastDue: null, invoiceDate: null, dueDate: null },
            { invoiceNo: "INV-EXISTING", customerName: "Old Corp", amountOpen: 1000, status: "open", daysPastDue: null, invoiceDate: null, dueDate: null },
            { invoiceNo: "INV-EXISTING", customerName: "Old Corp", amountOpen: 2000, status: "open", daysPastDue: null, invoiceDate: null, dueDate: null },
            { invoiceNo: "", customerName: "Bad Corp", amountOpen: 100, status: "open", daysPastDue: null, invoiceDate: null, dueDate: null }
        ];

        const req = new NextRequest("http://localhost/api/upload/ar", {
            method: "POST",
            headers: { "x-tenant-id": companyId },
            body: JSON.stringify({ companyId, rows, mappingJson: {} })
        });
        
        const res = await arPost(req);
        const data = await res.json();
        
        expect(res.status).toBe(200);
        expect(data.newCount).toBe(1);
        expect(data.dupeCount).toBe(1);
        expect(data.changedCount).toBe(1);
        expect(data.invalidCount).toBe(1);
        expect(data.reviewStatus).toBe("staged"); // Because of changed_existing

        // Verify StagedImportRows
        const staged = await prisma.stagedImportRow.findMany({ where: { importBatchId: data.batchId }, orderBy: { sourceRowNumber: "asc" } });
        expect(staged.length).toBe(4);

        expect(staged[0].conflictType).toBe("new");
        expect(staged[0].userDecision).toBe("accept_insert");

        expect(staged[1].conflictType).toBe("exact_duplicate");
        expect(staged[1].userDecision).toBe("skip");

        expect(staged[2].conflictType).toBe("changed_existing");
        expect(staged[2].userDecision).toBeNull(); // Needs human review

        expect(staged[3].conflictType).toBe("invalid");
        expect(staged[3].userDecision).toBe("skip");
    });

    it("does not delete omitted or hidden records", async () => {
        const invoices = await prisma.receivableInvoice.findMany({ where: { companyId } });
        // Still should have EXISTING and HIDDEN (2 invoices total)
        expect(invoices.length).toBe(2);
        const ids = invoices.map(i => i.invoiceNo);
        expect(ids).toContain("INV-EXISTING");
        expect(ids).toContain("INV-HIDDEN");
    });
});
