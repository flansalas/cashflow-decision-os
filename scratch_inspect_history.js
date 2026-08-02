require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const companyId = '1a7b36f5-8fe0-4c2b-9336-8420846270b5'; // Cascio
  
  console.log("--- Change Logs ---");
  const changeLogs = await prisma.changeLog.findMany({
    where: { companyId },
    orderBy: { timestamp: 'desc' },
    take: 10
  });
  console.log(`Found ${changeLogs.length} change logs.`);
  for (const log of changeLogs) {
    console.log(`[${log.timestamp.toISOString()}] ${log.source} - ${log.action}`);
    if (log.diffJson) {
        console.log(`Diff: ${log.diffJson.substring(0, 200)}...`);
    }
  }

  console.log("\n--- Import Apply Changes ---");
  const importChanges = await prisma.importApplyChange.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take: 5
  });
  console.log(`Found ${importChanges.length} import apply changes.`);
  for (const c of importChanges) {
    console.log(`[${c.createdAt.toISOString()}] ${c.entityType} ${c.operation} ID: ${c.entityId}`);
  }

  console.log("\n--- Recurring Patterns ---");
  const recurring = await prisma.recurringPattern.findMany({
    where: { companyId },
    take: 5
  });
  console.log(`Found ${recurring.length} recurring patterns.`);
  
  console.log("\n--- Overrides ---");
  const overrides = await prisma.override.findMany({
    where: { companyId },
    take: 5
  });
  console.log(`Found ${overrides.length} overrides.`);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
    pool.end();
  });
