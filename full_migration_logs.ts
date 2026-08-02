import prisma from './src/db/prisma';

async function main() {
    console.log("Fetching full migration logs...");
    const rows = await prisma.$queryRawUnsafe(`
        SELECT id, checksum, started_at, finished_at, applied_steps_count, rolled_back_at, migration_name, logs 
        FROM _prisma_migrations 
        WHERE migration_name IN ('20260709011700_add_execution_plan_fields', '20260701200739_add_execution_plan');
    `);
    console.log(JSON.stringify(rows, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
