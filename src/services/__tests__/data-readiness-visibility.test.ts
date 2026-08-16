import { describe, expect, it, vi } from "vitest";
import { computeARPopulationHash } from "@/services/data-readiness-evaluation";
import { buildManagerialVisibility } from "@/services/managerial-visibility";

const companyId = "tenant-a";
const invoices = Array.from({ length: 21 }, (_, index) => ({
    id: `invoice-${index + 1}`,
    customerName: `Customer ${index + 1}`,
    invoiceNo: `INV-${index + 1}`,
    amountOpen: index + 1,
    dueDate: new Date("2026-08-10T00:00:00.000Z"),
    status: "open"
}));

function hashFor(overrides: Array<{ targetId: string | null; targetType: string }>) {
    return computeARPopulationHash(companyId, {
        receivableInvoice: { findMany: vi.fn().mockResolvedValue(invoices) },
        override: { findMany: vi.fn().mockResolvedValue(overrides) }
    } as any);
}

describe("AR readiness managerial visibility", () => {
    const currentExclusions = [1, 2, 3, 4, 5].map(number => ({
        targetId: `invoice-${number}`,
        targetType: "receivable_invoice"
    }));

    it("represents five current exclusions from the 21-row raw population", () => {
        const visibility = buildManagerialVisibility(currentExclusions);

        expect(visibility.hiddenInvoiceIds).toEqual(new Set(currentExclusions.map(override => override.targetId)));
        expect(invoices.filter(invoice => !visibility.hiddenInvoiceIds.has(invoice.id))).toHaveLength(16);
    });

    it("changes the readiness hash when an invoice is hidden or restored", async () => {
        const visibleHash = await hashFor([]);
        const hiddenHash = await hashFor(currentExclusions);
        const restoredHash = await hashFor(currentExclusions.slice(0, 4));

        expect(hiddenHash).not.toBe(visibleHash);
        expect(restoredHash).not.toBe(hiddenHash);
    });

    it("does not let a dangling exclusion contaminate the current population hash", async () => {
        const currentHash = await hashFor(currentExclusions);
        const hashWithDanglingExclusion = await hashFor([
            ...currentExclusions,
            { targetId: "historical-invoice-id", targetType: "receivable_invoice" }
        ]);

        expect(hashWithDanglingExclusion).toBe(currentHash);
    });
});
