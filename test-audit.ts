import prisma from './src/db/prisma';
async function main() {
  const logs = await prisma.changeLog.findMany({ take: 5, orderBy: { timestamp: "desc" } });
  console.log(JSON.stringify(logs, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
