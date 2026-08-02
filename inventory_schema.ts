import prisma from './src/db/prisma';

async function main() {
    console.log("Inventoring active tables...");
    const tables = await prisma.$queryRawUnsafe(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_name IN ('ExecutionPlan', 'BaselineVarianceLedger', 'ForecastEvaluationObservation', 'ActualCashAttribution', 'InternalTransferHistory', 'EvaluationJob');
    `);
    console.log(JSON.stringify(tables, null, 2));

    console.log("Inventoring columns for ExecutionPlan...");
    const columns = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'ExecutionPlan';
    `);
    console.log(JSON.stringify(columns, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
