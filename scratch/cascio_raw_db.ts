import { prisma } from '../src/db/prisma';

async function run() {
    const companyId = '1a7b36f5-8fe0-4c2b-9336-8420846270b5'; // Cascio
    
    // 1. rawM1Outflow
    const baseline = await prisma.baselineSnapshot.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'desc' }
    });
    const rawM1Outflow = baseline?.variableOutflowWeekly ?? 0;
    console.log("1. rawM1Outflow:", rawM1Outflow);
    
    // 2. varianceMultiplier
    const varianceLedger = await prisma.baselineVarianceLedger.findMany({
        where: { companyId },
        orderBy: { weekStart: "desc" },
        take: 8,
    });
    
    let inflow = 1.0;
    let outflow = 1.0;
    
    if (varianceLedger.length > 0) {
        let inSum = 0;
        let outSum = 0;
        let inCount = 0;
        let outCount = 0;
        for (const row of varianceLedger) {
            if (row.variancePctIn != null) {
                inSum += row.variancePctIn;
                inCount++;
            }
            if (row.variancePct != null) {
                outSum += row.variancePct;
                outCount++;
            }
        }
        if (inCount > 0) inflow = 1.0 + (inSum / inCount);
        if (outCount > 0) outflow = 1.0 + (outSum / outCount);
    }
    console.log("2. varianceMultiplier:", outflow);
    
    // 3. aiOutflowFactor
    // We need to fetch AI factors if they exist in assumption or somewhere
    const assumptions = await prisma.assumption.findFirst({
        where: { companyId }
    });
    console.log("3. aiOutflowFactor: 1.0 (assuming no DB field for AI factors yet)");
    
    // 4. projectionSafetyMargin
    const safetyMargin = assumptions?.projectionSafetyMargin ?? 1.0;
    console.log("4. projectionSafetyMargin:", safetyMargin);
    
    // 5. resulting outflowMultiplier
    const spendFade = 1.0; // from code default
    const outflowMultiplier = spendFade * (2 - safetyMargin);
    console.log("5. resulting outflowMultiplier:", outflowMultiplier);
    
    // 6. scheduledVariableOutflowSum
    // Fetch all open payable bills
    const bills = await prisma.payableBill.findMany({
        where: { companyId, status: 'open' }
    });
    
    // Find the week with the bill of ~$7687 or ~$10935.
    // Let's just group by week.
    // Actually, let's just dump all the open bills and their amounts.
    console.log("\n--- OPEN BILLS ---");
    let total = 0;
    for (const b of bills) {
        console.log(`${b.vendorName}: ${b.amountOpen} (Due: ${b.dueDate})`);
        total += b.amountOpen;
    }
    console.log("Total Open Bills:", total);
}

run().catch(console.error);
