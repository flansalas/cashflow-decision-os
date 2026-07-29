import 'dotenv/config';
import prisma from './src/db/prisma';

async function main() {
    const company = await prisma.company.findFirst({
        where: { name: { contains: "Cascio" } },
        include: {
            forecastCheckpoints: { 
                orderBy: { createdAt: 'desc' }, 
                take: 2,
                include: { componentSnapshots: true }
            },
            recurringPatterns: true,
            cashSnapshots: { orderBy: { createdAt: 'desc' }, take: 2 }
        }
    });

    if (company) {
        console.log("=== ROLL VERIFICATION REPORT ===");
        console.log(`Company: ${company.name}`);
        console.log(`Latest Cash Snapshot Balance: $${company.cashSnapshots[0]?.bankBalance}`);
        console.log(`Previous Cash Snapshot Balance: $${company.cashSnapshots[1]?.bankBalance}`);
        
        const latestCheckpoint = company.forecastCheckpoints[0];
        console.log(`\n--- Checkpoint Macro-Memory ---`);
        console.log(`Checkpoint Created At: ${latestCheckpoint?.createdAt}`);
        console.log(`Forecast Week Target: ${latestCheckpoint?.weekStart} to ${latestCheckpoint?.weekEnd}`);
        console.log(`Expected End Cash: $${latestCheckpoint?.endCashExpected}`);
        console.log(`Total Component Snapshots Saved: ${latestCheckpoint?.componentSnapshots?.length}`);
        
        console.log(`\n--- Slice 1-5 Component Snapshots ---`);
        if (latestCheckpoint?.componentSnapshots) {
            const inflows = latestCheckpoint.componentSnapshots.filter((s: any) => s.direction === 'inflow');
            const outflows = latestCheckpoint.componentSnapshots.filter((s: any) => s.direction === 'outflow');
            console.log(`Inflow components tracked: ${inflows.length}`);
            console.log(`Outflow components tracked: ${outflows.length}`);
            
            // Log first few to verify properties
            if (inflows.length > 0) {
                console.log(`Sample Inflow: Category=${inflows[0].componentCategory}, Amount=$${inflows[0].projectedAmount}, SourceType=${inflows[0].sourceType}`);
            }
        }
        
        console.log(`\n--- Recurring Patterns Roll Check ---`);
        company.recurringPatterns.forEach((rp: any) => {
            console.log(`Pattern ${rp.displayName}: Next Date = ${rp.nextExpectedDate}, Cadence = ${rp.cadence}`);
        });

    } else {
        console.log("Company not found.");
    }
}
main().finally(() => process.exit(0));
