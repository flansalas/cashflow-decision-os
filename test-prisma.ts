// @ts-nocheck
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const cascio = await prisma.company.findFirst({ where: { name: { contains: "Cascio" } } });
  if (!cascio) {
    console.log("Cascio account not found.");
    return;
  }
  console.log("Cascio companyId:", cascio.id);

  const snapshot = await prisma.baselineSnapshot.findUnique({
    where: { companyId: cascio.id }
  });

  if (!snapshot) {
    console.log("No baseline snapshot found for Cascio.");
    return;
  }

  console.log("Has AI Reasoning Log:", !!snapshot.aiReasoningLogJson);
  if (snapshot.aiReasoningLogJson) {
     console.log("Log excerpt:", snapshot.aiReasoningLogJson.substring(0, 100));
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
