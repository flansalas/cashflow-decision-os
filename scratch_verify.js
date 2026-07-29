const { Client } = require('pg');

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true"
});

async function main() {
    await client.connect();

    console.log("=== ROLL VERIFICATION REPORT ===");
    
    // 1. Get Company
    const companyRes = await client.query(`SELECT id, name FROM "Company" WHERE name ILIKE '%Cascio%' LIMIT 1`);
    if (companyRes.rows.length === 0) {
        console.log("Company not found");
        return;
    }
    const company = companyRes.rows[0];
    console.log(`Company: ${company.name}`);

    // 2. Get Cash Snapshots
    const cashRes = await client.query(`SELECT "bankBalance", "asOfDate", "createdAt" FROM "CashSnapshot" WHERE "companyId" = $1 ORDER BY "createdAt" DESC LIMIT 2`, [company.id]);
    console.log(`Latest Cash Snapshot Balance: $${cashRes.rows[0]?.bankBalance} (As of ${cashRes.rows[0]?.asOfDate})`);
    console.log(`Previous Cash Snapshot Balance: $${cashRes.rows[1]?.bankBalance} (As of ${cashRes.rows[1]?.asOfDate})`);

    // 3. Get Latest Checkpoint
    const checkpointRes = await client.query(`SELECT * FROM "ForecastCheckpoint" WHERE "companyId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [company.id]);
    if (checkpointRes.rows.length > 0) {
        const latestCheckpoint = checkpointRes.rows[0];
        console.log(`\n--- Checkpoint Macro-Memory ---`);
        console.log(`Checkpoint Created At: ${latestCheckpoint.createdAt}`);
        console.log(`Forecast Week Target: ${latestCheckpoint.weekStart} to ${latestCheckpoint.weekEnd}`);
        console.log(`Expected End Cash: $${latestCheckpoint.endCashExpected}`);
        
        // 4. Get Component Snapshots
        const compRes = await client.query(`SELECT "direction", "componentCategory", "projectedAmount", "sourceType" FROM "ForecastComponentSnapshot" WHERE "forecastCheckpointId" = $1`, [latestCheckpoint.id]);
        console.log(`Total Component Snapshots Saved: ${compRes.rows.length}`);
        
        const inflows = compRes.rows.filter(r => r.direction === 'inflow');
        const outflows = compRes.rows.filter(r => r.direction === 'outflow');
        console.log(`Inflow components tracked: ${inflows.length}`);
        console.log(`Outflow components tracked: ${outflows.length}`);
        
        if (inflows.length > 0) {
            console.log(`Sample Inflow: Category=${inflows[0].componentCategory}, Amount=$${inflows[0].projectedAmount}, SourceType=${inflows[0].sourceType}`);
        }
        if (outflows.length > 0) {
            console.log(`Sample Outflow: Category=${outflows[0].componentCategory}, Amount=$${outflows[0].projectedAmount}, SourceType=${outflows[0].sourceType}`);
        }
    }

    // 5. Get Recurring Patterns
    const patternsRes = await client.query(`SELECT "displayName", "nextExpectedDate", "cadence" FROM "RecurringPattern" WHERE "companyId" = $1 ORDER BY "nextExpectedDate" ASC LIMIT 5`, [company.id]);
    console.log(`\n--- Recurring Patterns Roll Check ---`);
    patternsRes.rows.forEach(rp => {
        console.log(`Pattern ${rp.displayName}: Next Date = ${rp.nextExpectedDate.toISOString().split('T')[0]}, Cadence = ${rp.cadence}`);
    });

    await client.end();
}

main().catch(console.error);
