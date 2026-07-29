const { Client } = require('pg');

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true"
});

async function main() {
    await client.connect();

    const companyRes = await client.query(`SELECT id FROM "Company" WHERE name ILIKE '%Cascio%' LIMIT 1`);
    if (companyRes.rows.length === 0) return;
    const companyId = companyRes.rows[0].id;

    // Get all transactions between June 22 and June 29 2026
    const txs = await client.query(`
        SELECT "txDate", amount, description
        FROM "BankTransaction" 
        WHERE "companyId" = $1 
        AND "txDate" > '2026-06-22' 
        AND "txDate" <= '2026-06-29'
        ORDER BY amount DESC
    `, [companyId]);
    
    console.log("Top Inflows for Week of June 22 - June 29:");
    txs.rows.filter(t => t.amount > 0).slice(0, 10).forEach(t => {
        console.log(`- ${t.txDate.toISOString().split('T')[0]}: $${t.amount} | ${t.description}`);
    });
    
    console.log("\nTop Outflows for Week of June 22 - June 29:");
    txs.rows.filter(t => t.amount < 0).slice(0, 10).forEach(t => {
        console.log(`- ${t.txDate.toISOString().split('T')[0]}: $${t.amount} | ${t.description}`);
    });

    const sums = await client.query(`
        SELECT 
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as in_sum,
            SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) as out_sum
        FROM "BankTransaction" 
        WHERE "companyId" = $1 AND "txDate" > '2026-06-22' AND "txDate" <= '2026-06-29'
    `, [companyId]);
    
    console.log(`\nTotal Inflow for week: $${sums.rows[0].in_sum}`);
    console.log(`Total Outflow for week: $${sums.rows[0].out_sum}`);
    console.log(`Net Change: $${sums.rows[0].in_sum + sums.rows[0].out_sum}`);

    await client.end();
}
main().catch(console.error);
