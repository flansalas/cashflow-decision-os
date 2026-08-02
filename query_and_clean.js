import { prisma } from './src/db/prisma.js';
const COMPANY_ID = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb";
async function main() {
    console.log("Checking for Synthetic Preview BankAccount...");
    // 1. Get Synthetic BankAccount
    let account = await prisma.bankAccount.findFirst({
        where: {
            companyId: COMPANY_ID,
            name: "Synthetic Preview Account"
        }
    });
    if (!account) {
        console.log("Synthetic account not found. Creating one...");
        account = await prisma.bankAccount.create({
            data: {
                companyId: COMPANY_ID,
                name: "Synthetic Preview Account"
            }
        });
        console.log(`Created BankAccount ID: ${account.id}`);
    }
    else {
        console.log(`Found BankAccount ID: ${account.id}`);
    }
    // 2. Find and delete the 4 synthetic transactions
    console.log("Searching for synthetic transactions to delete...");
    const txs = await prisma.bankTransaction.findMany({
        where: {
            companyId: COMPANY_ID,
            description: {
                in: ["Synthetic Inflow Test", "Synthetic Outflow Test", "Internal Transfer In", "Internal Transfer Out"]
            }
        }
    });
    console.log(`Found ${txs.length} synthetic transactions.`);
    const ids = [];
    for (const tx of txs) {
        console.log(`- Deleting TX ID: ${tx.id} (${tx.description} / ${tx.amount})`);
        ids.push(tx.id);
    }
    if (ids.length > 0) {
        await prisma.bankTransaction.deleteMany({
            where: {
                id: { in: ids }
            }
        });
        console.log("Deleted the transactions.");
    }
}
main().finally(() => prisma.$disconnect());
