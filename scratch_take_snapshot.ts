import { PrismaClient } from '@prisma/client';
import fs from 'fs';

const prisma = new PrismaClient();

async function main() {
    const company = await prisma.company.findFirst({
        where: { name: { contains: "Cascio" } },
        include: {
            bankTransactions: { take: 500 },
            receivableInvoices: true,
            payableBills: true,
            recurringPatterns: true,
            baselineVarianceLedgers: true,
            forecastCheckpoints: { take: 10 }
        }
    });

    if (company) {
        const path = '/Users/flans/.gemini/antigravity/brain/3b3f8224-82e1-4160-8246-336c11bd618d/cascio_pre_roll_snapshot.json';
        fs.writeFileSync(path, JSON.stringify(company, null, 2));
        console.log(`Snapshot saved to: ${path}`);
    } else {
        console.log("Company not found.");
    }
}
main().finally(() => prisma.$disconnect());
