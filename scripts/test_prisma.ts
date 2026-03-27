import prisma from '../src/db/prisma'

async function test() {
    try {
        const company = await prisma.company.create({
            data: {
                name: "Test Company",
                isDemo: false,
                onboardingCompleted: false,
                onboardingStep: 0,
            },
        });
        console.log("Successfully created company:", company.id);
        await prisma.company.delete({ where: { id: company.id } });
        console.log("Cleanup successful.");
    } catch (err) {
        console.error("Test failed:", err);
    } finally {
        await prisma.$disconnect();
    }
}

test();
