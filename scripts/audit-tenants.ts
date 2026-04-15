/**
 * Audit: verify DB clerkOrgId mappings for all companies.
 * Also uses Clerk Backend SDK to verify org membership for a given user.
 * Run: npx tsx scripts/audit-tenants.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log("\n=== DB COMPANY / clerkOrgId AUDIT ===\n");

    const companies = await prisma.company.findMany({
        select: { id: true, name: true, clerkOrgId: true, isDemo: true, createdAt: true },
        orderBy: { createdAt: "asc" },
    });

    for (const c of companies) {
        console.log(`Company: "${c.name}"`);
        console.log(`  id:         ${c.id}`);
        console.log(`  clerkOrgId: ${c.clerkOrgId ?? "(NULL — no Clerk mapping)"}`);
        console.log(`  isDemo:     ${c.isDemo}`);
        console.log(`  createdAt:  ${c.createdAt.toISOString()}`);
        console.log("");
    }

    // Clerk Backend API check — list orgs for the user
    const clerkSecret = process.env.CLERK_SECRET_KEY;
    if (!clerkSecret) {
        console.log("CLERK_SECRET_KEY not set — skipping Clerk API check");
        return;
    }

    const TARGET_EMAIL = "flansalas@yahoo.com";
    console.log(`\n=== CLERK API: checking memberships for ${TARGET_EMAIL} ===\n`);

    // 1. Find user by email
    const userRes = await fetch(
        `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(TARGET_EMAIL)}`,
        { headers: { Authorization: `Bearer ${clerkSecret}` } }
    );
    const users = await userRes.json() as Array<{ id: string; email_addresses: Array<{ email_address: string }> }>;

    if (!users || users.length === 0) {
        console.log(`  ERROR: User ${TARGET_EMAIL} not found in Clerk production instance`);
        return;
    }

    const user = users[0];
    console.log(`  Clerk userId: ${user.id}`);

    // 2. Get org memberships for that user
    const memRes = await fetch(
        `https://api.clerk.com/v1/users/${user.id}/organization_memberships?limit=20`,
        { headers: { Authorization: `Bearer ${clerkSecret}` } }
    );
    const memData = await memRes.json() as { data: Array<{ organization: { id: string; name: string }; role: string }> };
    const memberships = memData?.data ?? [];

    if (memberships.length === 0) {
        console.log("  WARNING: User has NO organization memberships in Clerk.");
    } else {
        console.log(`  Memberships (${memberships.length}):`);
        for (const m of memberships) {
            const orgId = m.organization.id;
            const orgName = m.organization.name;
            const role = m.role;

            // Cross-reference with DB
            const dbMatch = companies.find(c => c.clerkOrgId === orgId);

            console.log(`\n    Clerk Org: "${orgName}"`);
            console.log(`    orgId:     ${orgId}`);
            console.log(`    role:      ${role}`);
            console.log(`    DB match:  ${dbMatch ? `✅ "${dbMatch.name}" (id=${dbMatch.id})` : "❌ NO MATCH in DB"}`);
        }
    }

    // 3. Check DB companies that have clerkOrgId but no Clerk membership
    console.log("\n=== REVERSE CHECK: DB clerkOrgIds not in user's memberships ===\n");
    const memberOrgIds = new Set(memberships.map(m => m.organization.id));
    for (const c of companies) {
        if (c.clerkOrgId && !memberOrgIds.has(c.clerkOrgId)) {
            console.log(`  ⚠️  "${c.name}" has clerkOrgId=${c.clerkOrgId} but user is NOT a member of this Clerk org`);
        }
    }
}

main()
    .then(() => { console.log("\nAudit complete."); process.exit(0); })
    .catch(e => { console.error("SCRIPT_ERROR:", e); process.exit(1); })
    .finally(() => pool.end());
