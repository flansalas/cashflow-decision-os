/**
 * One-time fix: correct the clerkOrgId for Cascio and Sons Construction.
 * The value stored in DB was a manual copy with O/0 and l/1 confusion.
 * Run: npx tsx scripts/fix-cascio-org-id.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// The WRONG value currently in the DB (zero, one)
const OLD_ORG_ID = "org_3CK3tdHaQYLW010gwk5cMVV1k99";

// The CORRECT value Clerk sends on the server JWT (letter O, lowercase l)
const CORRECT_ORG_ID = "org_3CK3tdHaQYLWO10gwk5cMVVlk99";

async function main() {
    console.log(`OLD_ORG_ID=${OLD_ORG_ID}`);
    console.log(`CORRECT_ORG_ID=${CORRECT_ORG_ID}`);

    // Find the current row
    const before = await prisma.company.findFirst({
        where: { clerkOrgId: OLD_ORG_ID },
        select: { id: true, name: true, clerkOrgId: true }
    });

    if (!before) {
        console.log(`ERROR: No company found with clerkOrgId=${OLD_ORG_ID}`);
        console.log("Listing all non-null clerkOrgIds in DB:");
        const all = await prisma.company.findMany({
            where: { clerkOrgId: { not: null } },
            select: { name: true, clerkOrgId: true }
        });
        for (const c of all) {
            console.log(`  "${c.name}" -> ${c.clerkOrgId}`);
        }
        return;
    }

    console.log(`FOUND_COMPANY=${before.name} id=${before.id}`);

    // Apply the update
    const updated = await prisma.company.update({
        where: { id: before.id },
        data: { clerkOrgId: CORRECT_ORG_ID },
        select: { id: true, name: true, clerkOrgId: true }
    });

    console.log(`UPDATED_DB_CLERK_ORG_ID=${updated.clerkOrgId}`);
    console.log(`UPDATE_SUCCESS=${updated.clerkOrgId === CORRECT_ORG_ID}`);
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error("SCRIPT_ERROR:", e); process.exit(1); })
    .finally(() => pool.end());
