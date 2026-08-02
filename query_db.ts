import prisma from './src/db/prisma';

async function main() {
    const companyId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb"; // The synthetic company ID
    
    const manifests = await prisma.bankImportManifest.findMany({ where: { companyId } });
    const transactions = await prisma.bankTransaction.findMany({ where: { companyId } });
    const evaluationJobs = await prisma.evaluationJob.findMany({ where: { companyId } });
    const evaluationJobTriggers = await prisma.evaluationJobTrigger.findMany({ 
        where: { companyId } 
    });
    
    console.log("Manifests count:", manifests.length);
    console.log("Manifest IDs:", manifests.map(m => m.id));
    console.log("Bank transactions count:", transactions.length);
    console.log("EvaluationJobs count:", evaluationJobs.length);
    console.log("EvaluationJobs IDs:", evaluationJobs.map(j => j.id));
    console.log("EvaluationJobTriggers count:", evaluationJobTriggers.length);
}
main().finally(() => prisma.$disconnect());
