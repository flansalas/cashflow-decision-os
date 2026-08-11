import prisma from "@/db/prisma";

type VisibilityOverride = {
    targetId: string | null;
    targetType: string;
};

export type ManagerialVisibility = {
    hiddenInvoiceIds: Set<string>;
    hiddenBillIds: Set<string>;
    hiddenItemIds: Set<string>;
};

/**
 * The existing active `exclude` override is the sole managerial-visibility
 * authority. Source AR/AP rows remain intact in the accounting store.
 */
export function buildManagerialVisibility(overrides: VisibilityOverride[]): ManagerialVisibility {
    const hiddenInvoiceIds = new Set<string>();
    const hiddenBillIds = new Set<string>();

    for (const override of overrides) {
        if (!override.targetId) continue;
        if (override.targetType === "receivable_invoice" || override.targetType === "invoice") {
            hiddenInvoiceIds.add(override.targetId);
        } else if (override.targetType === "payable_bill" || override.targetType === "bill") {
            hiddenBillIds.add(override.targetId);
        }
    }

    return {
        hiddenInvoiceIds,
        hiddenBillIds,
        hiddenItemIds: new Set([...hiddenInvoiceIds, ...hiddenBillIds]),
    };
}

export async function getManagerialVisibility(companyId: string): Promise<ManagerialVisibility> {
    const overrides = await prisma.override.findMany({
        where: {
            companyId,
            type: "exclude",
            status: "active",
            targetId: { not: null },
        },
        select: { targetId: true, targetType: true },
    });

    return buildManagerialVisibility(overrides);
}

export function visibleInvoices<T extends { id: string }>(
    invoices: T[],
    visibility: ManagerialVisibility,
): T[] {
    return invoices.filter(invoice => !visibility.hiddenInvoiceIds.has(invoice.id));
}

export function visibleBills<T extends { id: string }>(
    bills: T[],
    visibility: ManagerialVisibility,
): T[] {
    return bills.filter(bill => !visibility.hiddenBillIds.has(bill.id));
}

/** Restore/unhide without deleting either the source row or its audit history. */
export async function restoreManagerialItem(companyId: string, targetId: string): Promise<number> {
    const result = await prisma.override.updateMany({
        where: {
            companyId,
            targetId,
            type: "exclude",
            status: "active",
        },
        data: { status: "archived" },
    });

    return result.count;
}
