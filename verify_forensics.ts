import prisma from './src/db/prisma';

async function main() {
  console.log('--- Bank Accounts ---');
  const acc1Id = '430e5b93-e1c6-4f4a-b27c-863c98475cc5';
  const acc2Id = 'ff926efc-6619-4a71-9e22-d8532a5611b0';
  
  const acc1 = await prisma.bankAccount.findUnique({ where: { id: acc1Id } });
  const acc2 = await prisma.bankAccount.findUnique({ where: { id: acc2Id } });
  
  console.log(`Account 1 (${acc1Id}):`);
  console.log(acc1 ? `Name: ${acc1.name}, CompanyId: ${acc1.companyId}, CreatedAt: ${acc1.createdAt.toISOString()}` : 'Not found');
  console.log(`Account 2 (${acc2Id}):`);
  console.log(acc2 ? `Name: ${acc2.name}, CompanyId: ${acc2.companyId}, CreatedAt: ${acc2.createdAt.toISOString()}` : 'Not found');

  const manifestAccs = await prisma.bankImportManifestAccount.findMany({
    where: { bankAccountId: { in: [acc1Id, acc2Id] } }
  });
  console.log(`\nManifest mapping points to: ${manifestAccs.map(m => m.bankAccountId).join(', ')}`);

  console.log('\n--- ForecastEvaluationObservation ---');
  const obs = await prisma.forecastEvaluationObservation.findMany({
    orderBy: { horizonWeeks: 'asc' }
  });
  
  console.log('\n--- ForecastEvaluationRun ---');
  const runs = await prisma.forecastEvaluationRun.findMany();
  console.log(`Total runs: ${runs.length}`);
  
  console.log('\n--- ForecastComponentEvaluation ---');
  const compEvals = await prisma.forecastComponentEvaluation.findMany();
  console.log(`Total component evals: ${compEvals.length}`);
  
  const validitySet = new Set(obs.map(o => o.evaluationValidity));
  const completenessSet = new Set(obs.map(o => o.accountCompleteness));
  console.log(`Unique completeness statuses: ${Array.from(completenessSet).join(', ')}`);
  console.log(`Unique validity statuses: ${Array.from(validitySet).join(', ')}`);
  
  console.log('\n--- BaselineSnapshotHistory (M1 untouched check) ---');
  const bsh = await prisma.baselineSnapshotHistory.findMany({ take: 1, orderBy: { createdAt: 'desc' } });
  if (bsh.length > 0) {
    console.log(`Latest snapshot M1 factor JSON changed? (Not directly testable without previous state, but we can verify if M4 is recorded instead of M1 for this evaluation job if it was M4-only or check if there was any recent BaselineSnapshotHistory update)`);
    console.log(`Latest BSH ID: ${bsh[0].id}, createdAt: ${bsh[0].createdAt.toISOString()}`);
  }

  console.log('\n--- Internal Transfers ---');
  const transfers = await prisma.bankTransaction.findMany({
    where: {
      OR: [
        { amount: 200 },
        { amount: -200 }
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 2
  });
  
  console.log(`Found ${transfers.length} transactions with amount 200 / -200`);
  transfers.forEach(t => {
    console.log(`Tx ID: ${t.id}, Amount: ${t.amount}, internalTransferStatus: ${t.internalTransferStatus}`);
  });
  
  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
