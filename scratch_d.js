require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const cps = await prisma.forecastCheckpoint.findMany({ where: { companyId: '1a7b36f5-8fe0-4c2b-9336-8420846270b5' }, select: { id: true } });
    const cpIds = cps.map(c => c.id);
    
    console.log(`Cascio checkpoints: ${cpIds.length}`);
    
    const count = await prisma.forecastComponentSnapshot.count({
        where: { forecastCheckpointId: { in: cpIds } }
    });
    
    console.log(`Component Snapshots for Cascio: ${count}`);

    const allCount = await prisma.forecastComponentSnapshot.count();
    console.log(`Total Component Snapshots in DB: ${allCount}`);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
    pool.end();
  });
