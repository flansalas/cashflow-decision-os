import prisma from './src/db/prisma';

async function main() {
    // The ID of the synthetic company created earlier
    const companyId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb";
    
    // Check if snapshot exists
    const existing = await prisma.cashSnapshot.findFirst({
        where: { companyId }
    });
    
    if (existing) {
        console.log("Snapshot already exists:", existing.id);
        return;
    }
    
    const newSnapshot = await prisma.cashSnapshot.create({
        data: {
            companyId: companyId,
            bankBalance: 50000.00,
            asOfDate: new Date()
        }
    });
    
    console.log("Created synthetic CashSnapshot:", newSnapshot.id, "with balance", newSnapshot.bankBalance);
}
main().finally(() => prisma.$disconnect());
