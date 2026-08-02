import prisma from './src/db/prisma';

async function main() {
    const orgId = "org_3C5Tfg6SPRflDHu2cLuR3IfsuAR";
    
    // Check if company exists
    const existing = await prisma.company.findUnique({
        where: { clerkOrgId: orgId }
    });
    
    if (existing) {
        console.log("Company already mapped:", existing.id);
        return;
    }
    
    const newCompany = await prisma.company.create({
        data: {
            name: "Synthetic Preview Test Company",
            clerkOrgId: orgId,
            isDemo: true,
            onboardingCompleted: true,
            onboardingStep: 3
        }
    });
    
    console.log("Created mapped company:", newCompany.id);
}
main().finally(() => prisma.$disconnect());
