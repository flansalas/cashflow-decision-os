import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import prisma from './src/db/prisma';
async function main() {
  const duplicates = await prisma.$queryRaw`
    SELECT "companyId", "merchantKey", COUNT(*)
    FROM "RecurringPattern"
    GROUP BY "companyId", "merchantKey"
    HAVING COUNT(*) > 1
  `;
  for (const dup of duplicates as any[]) {
    const records = await prisma.recurringPattern.findMany({
      where: { companyId: dup.companyId, merchantKey: dup.merchantKey },
      orderBy: { createdAt: 'desc' }
    });
    // Keep the first (newest), delete the rest
    const toDelete = records.slice(1).map((r: any) => r.id);
    await prisma.recurringPattern.deleteMany({ where: { id: { in: toDelete } } });
  }
}
main().then(() => console.log('Duplicates removed')).catch(console.error);
