import prisma from './src/db/prisma';
async function main() {
    const companies = await prisma.company.findMany({ select: { id: true, name: true, clerkOrgId: true }});
    console.log("Companies:", companies);
}
main().finally(() => prisma.$disconnect());
