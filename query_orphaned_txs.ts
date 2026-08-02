import prisma from "./src/db/prisma";

async function main() {
    const txs = await prisma.bankTransaction.findMany({
        where: {
            companyId: "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb"
        },
        orderBy: { createdAt: 'desc' },
        take: 10
    });
    console.log("Found", txs.length, "txs for company");
    for (const tx of txs) {
        console.log(tx.id, tx.description, tx.amount, tx.createdAt);
    }
}
main().catch(console.error).finally(() => prisma.$disconnect());
