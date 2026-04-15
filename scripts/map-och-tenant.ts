/**
 * map-och-tenant.ts
 * Finds OCH Clerk org ID (production) and upserts the Company row in production Neon DB.
 *
 * Usage:
 *   CLERK_PROD_SECRET=sk_live_xxx npx tsx scripts/map-och-tenant.ts
 *
 * Or: set CLERK_PROD_SECRET in .env.prod-secrets and run:
 *   npx dotenv -e .env.prod-secrets -- npx tsx scripts/map-och-tenant.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const prodSecret = process.env.CLERK_PROD_SECRET ?? process.env.CLERK_SECRET_KEY;
const dbUrl = process.env.DATABASE_URL;

if (!prodSecret) {
    console.error("ERROR: Set CLERK_PROD_SECRET=sk_live_... before running.");
    process.exit(1);
}
if (!prodSecret.startsWith("sk_live_")) {
    console.error(`ERROR: Key starts with "${prodSecret.slice(0, 12)}..." — this is NOT a production key.`);
    console.error("Set CLERK_PROD_SECRET=sk_live_... explicitly.");
    process.exit(1);
}

const pool = new pg.Pool({ connectionString: dbUrl });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    // 1. Find OCH org in production Clerk
    console.log("\n[1] Querying production Clerk for org named 'OCH'...");
    const res = await fetch("https://api.clerk.com/v1/organizations?limit=50", {
        headers: { Authorization: `Bearer ${prodSecret}` },
    });
    const data = await res.json() as { data: Array<{ id: string; name: string; slug: string }> };
    const orgs = data.data ?? [];

    console.log(`    Found ${orgs.length} org(s) total in production Clerk:`);
    for (const o of orgs) {
        console.log(`    - "${o.name}" | id=${o.id} | slug=${o.slug}`);
    }

    const och = orgs.find(o =>
        o.name.toLowerCase() === "och" ||
        o.slug?.toLowerCase() === "och"
    );

    if (!och) {
        console.error("\nERROR: Could not find an org named 'OCH' in production Clerk.");
        console.error("Names found:", orgs.map(o => o.name));
        process.exit(1);
    }

    const clerOrgId = och.id;
    console.log(`\n✅ OCH production Clerk org found:`);
    console.log(`   name:  ${och.name}`);
    console.log(`   orgId: ${clerOrgId}`);

    // 2. Check DB for existing Company
    console.log("\n[2] Checking production Neon DB for existing OCH Company row...");
    const existing = await prisma.company.findFirst({
        where: {
            OR: [
                { clerkOrgId: clerOrgId },
                { name: { contains: "OCH", mode: "insensitive" } },
            ],
        },
    });

    if (existing) {
        console.log(`\n    Found existing Company row:`);
        console.log(`    id:         ${existing.id}`);
        console.log(`    name:       ${existing.name}`);
        console.log(`    clerkOrgId: ${existing.clerkOrgId ?? "(null)"}`);

        if (existing.clerkOrgId === clerOrgId) {
            console.log("\n✅ clerkOrgId already correctly set. No DB update needed.");
        } else {
            console.log(`\n    Updating clerkOrgId: "${existing.clerkOrgId}" → "${clerOrgId}"`);
            await prisma.company.update({
                where: { id: existing.id },
                data: { clerkOrgId: clerOrgId },
            });
            console.log("✅ Updated.");
        }

        printSummary(clerOrgId, "found", existing.id, clerOrgId);
    } else {
        console.log("\n    No existing OCH Company row found. Creating minimal row...");
        const { v4: uuidv4 } = await import("uuid");
        const newId = uuidv4();
        await prisma.company.create({
            data: {
                id: newId,
                name: "OCH",
                clerkOrgId: clerOrgId,
                isDemo: false,
            },
        });
        console.log(`✅ Created new Company row.`);
        printSummary(clerOrgId, "created", newId, clerOrgId);
    }
}

function printSummary(clerkOrgId: string, action: "found" | "created", companyId: string, storedOrgId: string) {
    console.log("\n========== RESULT SUMMARY ==========");
    console.log(`OCH production Clerk org ID: ${clerkOrgId}`);
    console.log(`Company row:                 ${action}`);
    console.log(`Company ID:                  ${companyId}`);
    console.log(`Final stored clerkOrgId:     ${storedOrgId}`);
    console.log(`\nApp-side steps needed:`);
    console.log(`  - No code changes required.`);
    console.log(`  - Christine (cmurphy@skylineworld.org) must accept her Clerk invitation.`);
    console.log(`  - Once accepted, she can log in at app.evolvetoyourmax.com`);
    console.log(`    and the org switcher will show OCH automatically.`);
    console.log("=====================================\n");
}

main()
    .catch(e => { console.error("SCRIPT_ERROR:", e); process.exit(1); })
    .finally(() => pool.end());
