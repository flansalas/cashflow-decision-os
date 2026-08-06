import prisma from "@/db/prisma";
import { verifyBankCoverage } from "@/services/bank-coverage";
import { calculateResidualActuals } from "@/services/attribution";

/**
 * Synchronizes the BaselineVarianceLedger by comparing actual variable bank transactions
 * against the current statistical baseline for the past N weeks.
 * This function should be called automatically whenever new bank transactions are imported.
 */
export async function syncVarianceLedger(companyId: string) {
    console.log(`[variance-sync] Starting variance sync for company ${companyId}`);
    
    // 1. Get the current baseline expectations
    const snapshot = await prisma.baselineSnapshot.findUnique({
        where: { companyId }
    });

    if (!snapshot) {
        console.log(`[variance-sync] No BaselineSnapshot found for ${companyId}. Skipping sync.`);
        return;
    }

    const projectedOutflow = snapshot.variableOutflowWeekly;
    const projectedInflow = snapshot.variableInflowWeekly;

    if (projectedOutflow <= 0 && projectedInflow <= 0) {
        console.log(`[variance-sync] Baseline predictions are zero. Skipping sync.`);
        return;
    }

    // 2. Determine the weeks to check (last 8 weeks, Monday to Sunday)
    // We only check completed weeks (weeks where Sunday is in the past)
    const today = new Date();
    // Find the most recent Sunday
    const daysSinceSunday = today.getDay(); // 0 is Sunday
    const mostRecentSunday = new Date(today);
    mostRecentSunday.setDate(today.getDate() - daysSinceSunday);
    mostRecentSunday.setHours(23, 59, 59, 999);

    const WEEKS_TO_CHECK = 8;
    const weeksToProcess: { start: Date, end: Date }[] = [];

    for (let i = 0; i < WEEKS_TO_CHECK; i++) {
        const end = new Date(mostRecentSunday);
        end.setDate(mostRecentSunday.getDate() - (i * 7));
        
        const start = new Date(end);
        start.setDate(end.getDate() - 6);
        start.setHours(0, 0, 0, 0);

        weeksToProcess.push({ start, end });
    }

    // (recurring exclusion handled via attributions now)

    // 4. Process each week
    for (const week of weeksToProcess) {
        // Check if we already have a ledger entry for this week
        const existingEntry = await prisma.baselineVarianceLedger.findFirst({
            where: {
                companyId,
                weekStart: week.start
            }
        });

        // EVIDENCE GATE: Only process weeks with verified bank coverage
        const coverageDetails = await verifyBankCoverage(companyId, week.start, week.end);
        if (!coverageDetails.isVerified) {
            console.log(`[variance-sync] Week ${week.start.toISOString()} lacks verified bank coverage. Skipping.`);
            continue;
        }

        // Get bank transactions for this week, WITH attributions
        const txs = await prisma.bankTransaction.findMany({
            where: {
                companyId,
                txDate: { gte: week.start, lte: week.end }
            },
            include: { attributions: true }
        });

        // If no transactions, we don't know the actual variance. Skip.
        if (txs.length === 0) continue;

        const residuals = calculateResidualActuals(txs);
        const actualOutflow = residuals.residualOutflow;
        const actualInflow = residuals.residualInflow;

        // 5. Calculate Variance
        // Variance Pct = (Actual - Projected) / Projected
        const variancePct = projectedOutflow > 0 
            ? (actualOutflow - projectedOutflow) / projectedOutflow 
            : 0;
            
        const variancePctIn = projectedInflow > 0 
            ? (actualInflow - projectedInflow) / projectedInflow 
            : null;

        // 6. Upsert the Ledger Entry
        if (existingEntry) {
            // Only update if it significantly changed? 
            // Better to always keep it fresh based on any newly imported bank txs for that week.
            await prisma.baselineVarianceLedger.update({
                where: { id: existingEntry.id },
                data: {
                    projectedOutflow,
                    actualOutflow,
                    variancePct,
                    projectedInflow,
                    actualInflow,
                    variancePctIn
                }
            });
        } else {
            await prisma.baselineVarianceLedger.create({
                data: {
                    companyId,
                    weekStart: week.start,
                    projectedOutflow,
                    actualOutflow,
                    variancePct,
                    projectedInflow: projectedInflow > 0 ? projectedInflow : null,
                    actualInflow: projectedInflow > 0 ? actualInflow : null,
                    variancePctIn
                }
            });
        }
    }
    
    console.log(`[variance-sync] Completed variance sync for company ${companyId}`);
}
