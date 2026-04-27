require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    const cid = (await prisma.company.findFirst()).id;
    console.log("Using companyId:", cid);

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

    const mapped = cashFlowEntries.map(e => ({
        categoryId: e.categoryId,
        categoryName: e.category.name,
        direction: e.category.direction,
        label: e.label,
        amount: e.amount,
        targetDate: e.targetDate,
    }));
    console.log("Mapped exactly", mapped.length, "entries");
}
run().then(() => console.log("Done")).catch(e => console.error("CRASH:", e));
