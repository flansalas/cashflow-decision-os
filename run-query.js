const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const cascio = await prisma.company.findFirst({ where: { name: { contains: "Cascio" } } });
  if (!cascio) {
    console.log("No cascio company found");
    return;
  }
  console.log("Cascio ID:", cascio.id);
}
main();
