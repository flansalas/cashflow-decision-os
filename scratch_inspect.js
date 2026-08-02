require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');

const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Starting script...");
  const companies = await prisma.company.findMany();
  console.log(`Found ${companies.length} companies.\n`);

  for (const company of companies) {
    console.log(`=========================================`);
    console.log(`Company: ${company.name} (ID: ${company.id}, isDemo: ${company.isDemo})`);
    
    const checkpoints = await prisma.forecastCheckpoint.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: 'asc' }
    });
    console.log(`\n--- 1. Forecast Checkpoints ---`);
    console.log(`Count: ${checkpoints.length}`);
    if (checkpoints.length > 0) {
      console.log(`Date range: ${checkpoints[0].createdAt.toISOString()} to ${checkpoints[checkpoints.length - 1].createdAt.toISOString()}`);
      console.log(`Week start range: ${checkpoints.map(c => c.weekStart.toISOString().split('T')[0]).sort().join(', ')}`);
    }

    const componentSnapshots = await prisma.forecastComponentSnapshot.findMany({
      where: { checkpoint: { companyId: company.id } },
      orderBy: { createdAt: 'asc' }
    });
    console.log(`\n--- Forecast Component Snapshots ---`);
    console.log(`Count: ${componentSnapshots.length}`);
    if (componentSnapshots.length > 0) {
        console.log(`Date range: ${componentSnapshots[0].createdAt.toISOString()} to ${componentSnapshots[componentSnapshots.length - 1].createdAt.toISOString()}`);
    }

    const evalRuns = await prisma.forecastEvaluationRun.findMany({
      where: { companyId: company.id }
    });
    console.log(`\n--- Forecast Evaluation Runs ---`);
    console.log(`Count: ${evalRuns.length}`);
    const evalStatuses = evalRuns.reduce((acc, run) => {
        const status = run.isActive ? 'active' : 'inactive';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});
    console.log(`Statuses:`, evalStatuses);

    const bankTxs = await prisma.bankTransaction.findMany({
      where: { companyId: company.id },
      orderBy: { txDate: 'asc' }
    });
    console.log(`\n--- 2. Bank Transactions ---`);
    console.log(`Count: ${bankTxs.length}`);
    if (bankTxs.length > 0) {
      console.log(`Earliest: ${bankTxs[0].txDate.toISOString()}`);
      console.log(`Latest: ${bankTxs[bankTxs.length - 1].txDate.toISOString()}`);
      
      const byAccount = bankTxs.reduce((acc, tx) => {
        const accId = tx.accountId || 'unassigned';
        if (!acc[accId]) acc[accId] = { min: tx.txDate, max: tx.txDate, count: 0, sum: 0 };
        acc[accId].count++;
        acc[accId].sum += (tx.direction === 'inflow' ? tx.amount : -tx.amount);
        if (tx.txDate < acc[accId].min) acc[accId].min = tx.txDate;
        if (tx.txDate > acc[accId].max) acc[accId].max = tx.txDate;
        return acc;
      }, {});
      console.log(`By Account:`, JSON.stringify(byAccount, null, 2));
    }

    const cashSnapshots = await prisma.cashSnapshot.findMany({
      where: { companyId: company.id },
      orderBy: { asOfDate: 'asc' }
    });
    console.log(`\n--- Cash Snapshots ---`);
    console.log(`Count: ${cashSnapshots.length}`);
    if (cashSnapshots.length > 0) {
      console.log(`Earliest asOfDate: ${cashSnapshots[0].asOfDate.toISOString()}`);
      console.log(`Latest asOfDate: ${cashSnapshots[cashSnapshots.length - 1].asOfDate.toISOString()}`);
      console.log(`Latest bankBalance: ${cashSnapshots[cashSnapshots.length - 1].bankBalance}`);
    }

    const baselineSnapshot = await prisma.baselineSnapshot.findUnique({
      where: { companyId: company.id }
    });
    console.log(`\n--- 5. Baseline Snapshot ---`);
    if (baselineSnapshot) {
      console.log(`asOfDate: ${baselineSnapshot.asOfDate.toISOString()}`);
      console.log(`variableInflowWeekly: ${baselineSnapshot.variableInflowWeekly}`);
      console.log(`variableOutflowWeekly: ${baselineSnapshot.variableOutflowWeekly}`);
      console.log(`hasSufficientHistory: ${baselineSnapshot.hasSufficientHistory}`);
      console.log(`baselineConfidenceTier: ${baselineSnapshot.baselineConfidenceTier}`);
      console.log(`aiInflowFactors: ${baselineSnapshot.aiInflowFactorsJson}`);
      console.log(`aiOutflowFactors: ${baselineSnapshot.aiOutflowFactorsJson}`);
    } else {
      console.log(`No baseline snapshot found.`);
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
    pool.end();
  });
