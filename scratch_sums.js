const { Client } = require('pg');

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true"
});

async function main() {
    await client.connect();

    const companyRes = await client.query(`SELECT id, name FROM "Company" WHERE name ILIKE '%Cascio%' LIMIT 1`);
    if (companyRes.rows.length === 0) return;
    const company = companyRes.rows[0];

    const txs = await client.query(`
        SELECT 
            SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as total_inflows,
            SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) as total_outflows
        FROM "BankTransaction" 
        WHERE "companyId" = $1
    `, [company.id]);
    
    console.log("Historical Bank Tx Sums:");
    console.log(`Total Inflows: $${txs.rows[0].total_inflows}`);
    console.log(`Total Outflows: $${txs.rows[0].total_outflows}`);

    await client.end();
}
main().catch(console.error);
