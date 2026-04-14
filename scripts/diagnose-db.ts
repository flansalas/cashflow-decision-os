/**
 * Diagnostic script: checks company records and related data in production DB.
 * Run with: DATABASE_URL="..." npx tsx scripts/diagnose-db.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const TARGET_ORG_ID = "org_3CK3tdHaQYLW010gwk5cMVV1k99"; // Cascio and Sons

async function main() {
    console.log("\n=== DATABASE URL (host only) ===");
    const url = process.env.DATABASE_URL ?? "";
    // Show just the host so we can confirm which DB we are hitting
    const hostMatch = url.match(/@([^/]+)\//);
    console.log("Host:", hostMatch?.[1] ?? "(could not parse)");

    console.log("\n=== ALL COMPANIES ===");
    const companies = await prisma.company.findMany({
        select: { id: true, name: true, clerkOrgId: true, isDemo: true, onboardingCompleted: true, createdAt: true }
    });
    for (const c of companies) {
        console.log(JSON.stringify(c));
    }

    console.log("\n=== CASCIO LOOKUP (by clerkOrgId) ===");
    const cascio = await prisma.company.findUnique({
        where: { clerkOrgId: TARGET_ORG_ID },
        select: { id: true, name: true, clerkOrgId: true, onboardingCompleted: true }
    });
    console.log("Found:", JSON.stringify(cascio));

    if (!cascio) {
        console.log("\n❌ STOP: Cascio company not found by clerkOrgId. Run the mapping script first.");
        return;
    }

    const cid = cascio.id;

    console.log("\n=== DASHBOARD DATA CHECK for", cascio.name, "===");
    const [snapshot, invoices, bills, assumptions, adjustments, recurring] = await Promise.all([
        prisma.cashSnapshot.findFirst({ where: { companyId: cid }, orderBy: { asOfDate: "desc" }, select: { id: true, asOfDate: true, bankBalance: true } }),
        prisma.receivableInvoice.count({ where: { companyId: cid } }),
        prisma.payableBill.count({ where: { companyId: cid } }),
        prisma.assumption.findFirst({ where: { companyId: cid }, select: { id: true } }),
        prisma.cashAdjustment.count({ where: { companyId: cid } }),
        prisma.recurringPattern.count({ where: { companyId: cid } }),
    ]);

    console.log("cashSnapshot:       ", snapshot ? JSON.stringify(snapshot) : "❌ MISSING — dashboard will fail with 'No cash snapshot found'");
    console.log("receivableInvoices: ", invoices);
    console.log("payableBills:       ", bills);
    console.log("assumptions:        ", assumptions ? "✅ exists" : "⚠️  missing (will use defaults)");
    console.log("cashAdjustments:    ", adjustments);
    console.log("recurringPatterns:  ", recurring);

    if (!snapshot) {
        console.log("\n❌ ROOT CAUSE: No CashSnapshot → dashboard returns 400 'No cash snapshot found' → UI shows 'Loading forecast...' forever.");
        console.log("   → This company needs its bank balance entered (onboarding step) to generate a snapshot.");
        console.log("   → OR data needs to be migrated from Pilot company.");
    } else {
        console.log("\n✅ Snapshot exists. Dashboard should load. If it doesn't, the bug is in the auth/resolver layer, not data.");
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => pool.end());
