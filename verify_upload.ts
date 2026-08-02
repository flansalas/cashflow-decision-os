import prisma from './src/db/prisma';

async function main() {
  const batches = await prisma.importBatch.findMany({ orderBy: { uploadedAt: 'desc' } });
  const manifests = await prisma.bankImportManifest.findMany();
  const manifestAccounts = await prisma.bankImportManifestAccount.findMany();
  const transactions = await prisma.bankTransaction.findMany();
  const evalJobs = await prisma.evaluationJob.findMany();
  const triggers = await prisma.evaluationJobTrigger.findMany();
  
  console.log('--- ImportBatch ---');
  console.log(`Count: ${batches.length}`);
  if (batches.length > 0) {
    console.log(`ID: ${batches[0].id}, fileHash: ${batches[0].fileHash}`);
  }

  console.log('\n--- BankImportManifest ---');
  console.log(`Count: ${manifests.length}`);
  if (manifests.length > 0) {
    console.log(`ID: ${manifests[0].id}`);
    console.log(`Is Complete/Certified: ${manifests[0].userCertified}`);
  }

  console.log('\n--- BankImportManifestAccount ---');
  console.log(`Count: ${manifestAccounts.length}`);
  if (manifestAccounts.length > 0) {
    console.log(`Mapped BankAccount ID: ${manifestAccounts[0].bankAccountId}`);
  }

  console.log('\n--- BankTransaction ---');
  console.log(`Count: ${transactions.length}`);
  console.log(`IDs: ${transactions.map(t => t.id).join(', ')}`);

  console.log('\n--- EvaluationJob ---');
  console.log(`Count: ${evalJobs.length}`);
  if (evalJobs.length > 0) {
    console.log(`ID: ${evalJobs[0].id}, Status: ${evalJobs[0].status}`);
  }

  console.log('\n--- EvaluationJobTrigger ---');
  console.log(`Count: ${triggers.length}`);
  if (triggers.length > 0) {
    console.log(`Sources: ${triggers.map(t => t.source).join(', ')}`);
  }

  const dupTransactions = new Set(transactions.map(t => t.id)).size !== transactions.length;
  console.log('\n--- Duplicates ---');
  console.log(`Duplicate transactions exist: ${dupTransactions}`);

  await prisma.$disconnect();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
