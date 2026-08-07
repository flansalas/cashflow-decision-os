import prisma from '../src/db/prisma';

async function main() {
    const cid = '1a7b36f5-8fe0-4c2b-9336-8420846270b5';
    
    // Query information_schema using raw SQL
    const cols = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'BaselineVarianceLedger';
    `);
    console.log("=== COLUMNS ===");
    console.log(cols);

    const ledger = await prisma.baselineVarianceLedger.findMany({
        where: { companyId: cid },
        orderBy: { weekStart: 'desc' },
        take: 8
    });
    console.log("\n=== ROWS ===");
    ledger.forEach((r: any) => console.log(JSON.stringify(r)));

    const adj = await prisma.cashAdjustment.findMany({
        where: { companyId: cid, amount: 89171 }
    });
    console.log("\n=== CASH ADJUSTMENT ===");
    adj.forEach((r: any) => console.log(JSON.stringify(r)));

    const inv = await prisma.receivableInvoice.findMany({
        where: { companyId: cid, status: 'open', dueDate: { gte: new Date('2026-07-27'), lt: new Date('2026-08-03') } }
    });
    console.log("\n=== AR IN WEEK 1 ===");
    inv.forEach((r: any) => console.log(JSON.stringify(r)));

    await prisma.$disconnect();
}
main();
