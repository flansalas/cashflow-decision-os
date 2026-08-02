require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pg = require('pg');
const { startOfWeek, endOfWeek, subWeeks } = require('date-fns');

const connectionString = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";
const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const companyId = '1a7b36f5-8fe0-4c2b-9336-8420846270b5'; // Cascio

    console.log("=== 1. Cash Reconciliation ===");
    
    // Fetch all snapshots
    const snapshots = await prisma.cashSnapshot.findMany({
        where: { companyId },
        orderBy: { asOfDate: 'asc' }
    });

    // Fetch all transactions
    const txs = await prisma.bankTransaction.findMany({
        where: { companyId },
        orderBy: { txDate: 'asc' }
    });

    if (snapshots.length === 0) {
        console.log("No snapshots found.");
    } else {
        const earliestSnapshot = snapshots[0];
        console.log(`Anchor Snapshot: ${earliestSnapshot.asOfDate.toISOString()}, Balance: $${earliestSnapshot.bankBalance}`);
        
        let currentReconstructedBalance = earliestSnapshot.bankBalance;
        let txIdx = 0;
        
        // Fast forward txIdx to the anchor date
        while (txIdx < txs.length && txs[txIdx].txDate < earliestSnapshot.asOfDate) {
            txIdx++;
        }

        for (let i = 1; i < snapshots.length; i++) {
            const snap = snapshots[i];
            
            let txCount = 0;
            // Add transactions up to this snapshot's date
            while (txIdx < txs.length && txs[txIdx].txDate < snap.asOfDate) {
                const tx = txs[txIdx];
                currentReconstructedBalance += (tx.direction === 'inflow' ? tx.amount : -tx.amount);
                txCount++;
                txIdx++;
            }

            const diff = Math.abs(currentReconstructedBalance - snap.bankBalance);
            const diffPct = snap.bankBalance === 0 ? 0 : (diff / snap.bankBalance) * 100;
            
            console.log(`Snapshot [${snap.asOfDate.toISOString()}]:`);
            console.log(`  Stored Balance: $${snap.bankBalance.toFixed(2)}`);
            console.log(`  Reconstructed:  $${currentReconstructedBalance.toFixed(2)}`);
            console.log(`  Difference:     $${diff.toFixed(2)} (${diffPct.toFixed(2)}%)`);
            console.log(`  Transactions:   ${txCount}`);
            if (diff > 1) { // More than $1 difference
                 console.log("  >>> RECONCILIATION FAILED <<<");
            }
        }
    }

    console.log("\n=== 2. AI Baseline Trace ===");
    const baselineSnapshot = await prisma.baselineSnapshot.findUnique({
        where: { companyId }
    });
    
    if (baselineSnapshot) {
        console.log(`Historical Baseline Inflow (Weekly): $${baselineSnapshot.variableInflowWeekly.toFixed(2)}`);
        
        const currentMonday = startOfWeek(new Date('2026-07-27'), { weekStartsOn: 1 }); // Assuming asOfDate was July 27 based on prev output
        const endDate = endOfWeek(subWeeks(currentMonday, -12));
        
        const invoices = await prisma.receivableInvoice.findMany({
            where: { companyId, dueDate: { gte: currentMonday, lte: endDate } }
        });
        
        const weeklyInflowCoverage = new Array(13).fill(0);
        const weeklyAR = new Array(13).fill(0);
        
        for (let w = 0; w < 13; w++) {
            const wStart = subWeeks(currentMonday, -w);
            const wEnd = endOfWeek(wStart);
            
            const invSum = invoices
                .filter(i => i.dueDate && i.dueDate >= wStart && i.dueDate <= wEnd)
                .reduce((s, i) => s + i.amountOpen, 0);
                
            weeklyAR[w] = invSum;
            weeklyInflowCoverage[w] = baselineSnapshot.variableInflowWeekly > 0 ? Math.min(1.0, invSum / baselineSnapshot.variableInflowWeekly) : 0;
            
            console.log(`Week ${w+1} (${wStart.toISOString().split('T')[0]}):`);
            console.log(`  AR Scheduled: $${invSum.toFixed(2)}`);
            console.log(`  Coverage Ratio: ${weeklyInflowCoverage[w].toFixed(4)}`);
        }
        
        console.log(`\nAI Inflow Factors: ${baselineSnapshot.aiInflowFactorsJson}`);
        console.log(`AI Reasoning Log:\n${baselineSnapshot.aiReasoningLogJson}`);
    }

}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
    pool.end();
  });
