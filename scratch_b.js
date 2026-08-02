require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const cp = await prisma.forecastCheckpoint.findFirst({ where: { companyId: '1a7b36f5-8fe0-4c2b-9336-8420846270b5' }, orderBy: { generatedAt: 'desc' } });
    if (!cp || !cp.breakdownJson) {
        console.log("No breakdownJson");
        return;
    }
    const b = JSON.parse(cp.breakdownJson);
    console.log('Is Array?', Array.isArray(b));
    if (Array.isArray(b)) {
        console.log('Length:', b.length);
        console.log('First element keys:', Object.keys(b[0]));
    } else {
        console.log('Keys if object:', typeof b === 'object' ? Object.keys(b) : 'primitive');
    }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
    pool.end();
  });
