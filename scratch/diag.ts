import prisma from "../src/db/prisma";
import { Prisma } from "@prisma/client";

async function main() {
    const CASCIO_ID = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
    console.log("=== FINAL CASCIO PROD DIAGNOSTIC ===");
    
    // 1. Check ReconciliationLink existence in schema
    try {
        const hasReconciliationLink = !!Prisma.dmmf.datamodel.models.find(m => m.name === "ReconciliationLink");
        console.log(`ReconciliationLink exists in schema: ${hasReconciliationLink}`);
    } catch (e) {
        console.log(`ReconciliationLink check failed: ${e}`);
    }

    // 2. Compute Variance Multiplier
    const ledger = await prisma.baselineVarianceLedger.findFirst({
        where: { companyId: CASCIO_ID },
        orderBy: { weekStart: "desc" }
    });
    if (ledger) {
        // Mock computeVarianceMultipliers logic
        const eligibleRowIds = new Set(); // current behavior
        const isEligible = eligibleRowIds.has(ledger.id);
        const inflowMultiplier = isEligible ? Math.min(1.2, Math.max(0.8, ledger.variancePctIn ?? 1.0)) : 1.0;
        const outflowMultiplier = isEligible ? Math.min(1.2, Math.max(0.8, ledger.variancePct)) : 1.0;
        console.log(`Cascio Variance Multipliers: Inflow=${inflowMultiplier}, Outflow=${outflowMultiplier}`);
    } else {
        console.log("No variance ledger found for Cascio.");
    }

    // 3. Check Actual Cash for 2026-08-09
    const targetDate = new Date("2026-08-09T00:00:00Z");
    const actualFlows: any[] = await prisma.actualCashAttribution.findMany({
        where: {
            companyId: CASCIO_ID,
            targetWeekStart: targetDate,
            isActive: true
        }
    });
    const inTotal = actualFlows.filter(f => f.direction === "inflow").reduce((sum, f) => sum + f.amountAttributed, 0);
    const outTotal = actualFlows.filter(f => f.direction === "outflow").reduce((sum, f) => sum + f.amountAttributed, 0);
    console.log(`Cascio Actual Cash (2026-08-09): Inflow=$${inTotal.toFixed(2)}, Outflow=$${outTotal.toFixed(2)}`);
    
    // 4. Git SHA
    const execSync = require("child_process").execSync;
    const gitSha = execSync("git rev-parse HEAD").toString().trim();
    console.log(`Git SHA: ${gitSha}`);

}

main().catch(console.error).finally(() => process.exit(0));
