const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const patterns = await prisma.recurringPattern.findMany({
        where: { displayName: { contains: "CINCINNATI" } }
    });
    console.log("Patterns:", JSON.stringify(patterns, null, 2));
    
    const overrides = await prisma.override.findMany({
        where: { targetId: { in: patterns.map(p => p.id) } }
    });
    console.log("Overrides:", JSON.stringify(overrides, null, 2));
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
