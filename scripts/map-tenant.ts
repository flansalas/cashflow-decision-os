// scripts/map-tenant.ts
// Usage: npx tsx scripts/map-tenant.ts <INTERNAL_COMPANY_ID> <CLERK_ORG_ID>

import { config } from "dotenv";
config(); // Load the .env file BEFORE prisma initializes via hoisting

async function main() {
    console.log("=== Tenant Mapper ===");

    const args = process.argv.slice(2);
    if (args.length !== 2) {
        console.error("❌ Invalid arguments.");
        console.error("Usage: npx tsx scripts/map-tenant.ts <INTERNAL_COMPANY_ID> <CLERK_ORG_ID>");
        process.exit(1);
    }

    const [companyId, clerkOrgId] = args;

    if (!clerkOrgId.startsWith("org_")) {
        console.error("❌ clerkOrgId must start with 'org_'.");
        process.exit(1);
    }

    // Dynamically import prisma to ensure it initializes AFTER dotenv config is applied
    const { default: prisma } = await import("../src/db/prisma");

    // 1. Verify the company exists
    const company = await prisma.company.findUnique({
        where: { id: companyId }
    });

    if (!company) {
        console.error(`❌ Could not find internal Company with ID: ${companyId}`);
        process.exit(1);
    }

    if (company.clerkOrgId) {
        console.warn(`⚠️ Warning: Company "${company.name}" already has a clerkOrgId mapped (${company.clerkOrgId}).`);
        console.warn(`Running this will overwrite it with: ${clerkOrgId}`);
    }

    // 2. Perform the mapping update
    console.log(`\nMapping: "${company.name}" (ID: ${company.id}) -> Clerk Org: ${clerkOrgId}`);
    
    try {
        const updated = await prisma.company.update({
            where: { id: companyId },
            data: { clerkOrgId }
        });

        console.log("✅ Success! Company mapped successfully.");
        console.log(`Company ID: ${updated.id}`);
        console.log(`Clerk Org ID: ${updated.clerkOrgId}`);
    } catch (e) {
        console.error("❌ Failed to update company mapping.", e);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(console.error);
