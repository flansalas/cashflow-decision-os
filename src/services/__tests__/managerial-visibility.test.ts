import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
    mockPrisma: {
        override: {
            findMany: vi.fn(),
            updateMany: vi.fn(),
        },
    },
}));

vi.mock("@/db/prisma", () => ({ default: mockPrisma }));

import {
    buildManagerialVisibility,
    getManagerialVisibility,
    restoreManagerialItem,
    visibleBills,
    visibleInvoices,
} from "@/services/managerial-visibility";

describe("managerial AR/AP visibility", () => {
    beforeEach(() => vi.clearAllMocks());

    it("uses existing exclude overrides as the only hidden-item authority", () => {
        const visibility = buildManagerialVisibility([
            { targetId: "inv-hidden", targetType: "receivable_invoice" },
            { targetId: "bill-hidden", targetType: "payable_bill" },
            { targetId: "legacy-inv", targetType: "invoice" },
            { targetId: "other", targetType: "recurring_pattern" },
        ]);

        expect(visibleInvoices([{ id: "inv-hidden" }, { id: "inv-visible" }, { id: "legacy-inv" }], visibility))
            .toEqual([{ id: "inv-visible" }]);
        expect(visibleBills([{ id: "bill-hidden" }, { id: "bill-visible" }], visibility))
            .toEqual([{ id: "bill-visible" }]);
        expect(visibility.hiddenItemIds).not.toContain("other");
    });

    it("loads only active exclude overrides for the requested tenant", async () => {
        mockPrisma.override.findMany.mockResolvedValue([]);

        await getManagerialVisibility("tenant-a");

        expect(mockPrisma.override.findMany).toHaveBeenCalledWith({
            where: {
                companyId: "tenant-a",
                type: "exclude",
                status: "active",
                targetId: { not: null },
            },
            select: { targetId: true, targetType: true },
        });
    });

    it("restores an item by archiving its visibility override without deleting source data", async () => {
        mockPrisma.override.updateMany.mockResolvedValue({ count: 1 });

        await expect(restoreManagerialItem("tenant-a", "inv-hidden")).resolves.toBe(1);
        expect(mockPrisma.override.updateMany).toHaveBeenCalledWith({
            where: {
                companyId: "tenant-a",
                targetId: "inv-hidden",
                type: "exclude",
                status: "active",
            },
            data: { status: "archived" },
        });
    });
});
