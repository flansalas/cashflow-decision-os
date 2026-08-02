import prisma from './src/db/prisma';

async function main() {
    const migrations = await prisma.$queryRawUnsafe('SELECT id, checksum, started_at, applied_steps_count, migration_name FROM _prisma_migrations ORDER BY started_at;');
    console.log(JSON.stringify(migrations, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
