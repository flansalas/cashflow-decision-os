import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
    const company = await prisma.company.findFirst({
        orderBy: { createdAt: "desc" },
        include: { recurringPatterns: true }
    });
    console.log("Recent Company:", company?.name, "(id:", company?.id, ")");
    console.log("Onboarding Step:", company?.onboardingStep);
    console.log("Onboarding Completed:", company?.onboardingCompleted);
    console.log("Patterns:", JSON.stringify(company?.recurringPatterns, null, 2));
}
main();
