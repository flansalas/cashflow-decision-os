import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function run() {
    const snapshots = await prisma.cashSnapshot.findMany({
        orderBy: { asOfDate: 'desc' },
        take: 1
    });
    if (!snapshots.length) {
        console.log("No snapshots found.");
        return;
    }
    const cid = snapshots[0].companyId;
    console.log("Testing with companyId:", cid);

    const [
        company,
        cashSnapshot,
        cashAdjustments,
        invoicesRaw,
        billsRaw,
        customerProfiles,
        vendorProfiles,
        assumptionRaw,
        recurringPatternsRaw,
        overrides,
        bankTxs,
        companyNotes,
        cashFlowCategories,
        cashFlowEntries,
    ] = await Promise.all([
        prisma.company.findUnique({ where: { id: cid } }),
        prisma.cashSnapshot.findFirst({ where: { companyId: cid }, orderBy: { asOfDate: "desc" } }),
        prisma.cashAdjustment.findMany({ where: { companyId: cid } }),
        prisma.receivableInvoice.findMany({ where: { companyId: cid } }),
        prisma.payableBill.findMany({ where: { companyId: cid } }),
        prisma.customerProfile.findMany({ where: { companyId: cid } }),
        prisma.vendorProfile.findMany({ where: { companyId: cid } }),
        prisma.assumption.findFirst({ where: { companyId: cid } }),
        prisma.recurringPattern.findMany({ where: { companyId: cid } }),
        prisma.override.findMany({ where: { companyId: cid, status: "active" } }),
        prisma.bankTransaction.findMany({
            where: {
                companyId: cid,
                txDate: { gte: new Date(Date.now() - 84 * 86_400_000) },
            },
            select: { amount: true, txDate: true, description: true, direction: true },
        }),
        prisma.companyNote.findMany({ where: { companyId: cid } }),
        prisma.cashFlowCategory.findMany({ where: { companyId: cid }, orderBy: [{ direction: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
        prisma.cashFlowEntry.findMany({ where: { companyId: cid }, include: { category: true } }),
    ]);

    try {
        const cashFlowEntriesMapped = cashFlowEntries.map((e: any) => ({
            categoryId: e.categoryId,
            categoryName: e.category.name,
            direction: e.category.direction as "inflow" | "outflow",
            label: e.label,
            amount: e.amount,
            targetDate: e.targetDate,
        }));
        console.log("cashFlowEntriesMapped", cashFlowEntriesMapped);
    } catch (e: any) {
        console.error("Crash during mapping:", e);
    }
}
run()
    .then(() => process.exit(0))
    .catch(console.error);
