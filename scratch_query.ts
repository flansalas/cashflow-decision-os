import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const checkpoints = await prisma.forecastCheckpoint.findMany({
        orderBy: { createdAt: 'desc' },
        take: 3
    });
    console.log(JSON.stringify(checkpoints, null, 2));
}
main().finally(() => prisma.$disconnect());
