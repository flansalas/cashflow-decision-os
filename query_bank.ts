import prisma from './src/db/prisma';

async function main() {
    const companyId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb"; // The synthetic company ID
    const accounts = await prisma.bankAccount.findMany({ where: { companyId } });
    console.log("Bank accounts:", accounts);
}
main().finally(() => prisma.$disconnect());
