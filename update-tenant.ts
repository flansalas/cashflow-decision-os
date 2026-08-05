import prisma from "./src/db/prisma";

async function run() {
    const id = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb";
    const expectedOrgId = "org_3CK3tdHaQYLWO10gwk5cMVVlk99";
    const newOrgId = "org_3C5Tfg6SPRflDHu2cLuR3IfsuAR";

    const company = await prisma.company.findUnique({
        where: { id }
    });

    if (!company) {
        console.error("Company not found.");
        process.exit(1);
    }

    if (company.clerkOrgId !== expectedOrgId) {
        console.error(`Assertion failed: expected ${expectedOrgId}, got ${company.clerkOrgId}`);
        process.exit(1);
    }

    await prisma.company.update({
        where: { id },
        data: { clerkOrgId: newOrgId }
    });
    console.log(`Successfully updated company ${id} to ${newOrgId}`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
