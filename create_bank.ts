import prisma from './src/db/prisma';

async function main() {
    const companyId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb"; // The synthetic company ID
    
    let account = await prisma.bankAccount.findFirst({
        where: { companyId, name: "Preview Synthetic Checking Account" }
    });

    if (!account) {
        account = await prisma.bankAccount.create({
            data: {
                id: require("crypto").randomUUID(),
                companyId,
                name: "Preview Synthetic Checking Account"
            }
        });
        console.log("Created BankAccount:", account.id);
    } else {
        console.log("BankAccount already exists:", account.id);
    }

    // Identify the exactly 4 orphaned transactions
    const txs = await prisma.bankTransaction.findMany({ where: { companyId } });
    if (txs.length === 4) {
        console.log("Deleting orphaned transactions:", txs.map(t => t.id));
        await prisma.bankTransaction.deleteMany({
            where: { id: { in: txs.map(t => t.id) } }
        });
    } else if (txs.length > 0) {
        console.log(`Found ${txs.length} transactions, skipping exact delete.`);
    }

    console.log("Account ID for UI:", account.id);
}
main().finally(() => prisma.$disconnect());
