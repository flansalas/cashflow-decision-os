import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function check() {
    const url = process.env.DATABASE_URL || '';
    console.log('Runtime DATABASE_URL endpoint:', url.match(/@(ep-[a-z-]+-[a-z0-9]+)/)?.[1] || url);

    const company = await prisma.company.findUnique({
        where: { id: 'bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb' },
        select: { id: true, clerkOrgId: true }
    });

    console.log('Company Mapping:', company);
}

check().catch(console.error).finally(() => prisma.$disconnect());
