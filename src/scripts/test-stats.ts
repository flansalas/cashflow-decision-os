import prisma from "../db/prisma";

async function main() {
  const result = await prisma.bankTransaction.aggregate({
    _count: { id: true },
    _min: { txDate: true },
    _max: { txDate: true },
  });
  console.log("DB RESULT:", result);
}
main().catch(console.error).finally(() => prisma.$disconnect());
