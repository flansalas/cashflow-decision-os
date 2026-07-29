const { Client } = require('pg');

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true"
});

async function main() {
    await client.connect();

    const companyRes = await client.query(`SELECT id, name FROM "Company" WHERE name ILIKE '%Cascio%' LIMIT 1`);
    if (companyRes.rows.length === 0) return;
    const company = companyRes.rows[0];

    const cashRes = await client.query(`SELECT "bankBalance", "asOfDate" FROM "CashSnapshot" WHERE "companyId" = $1 ORDER BY "createdAt" DESC LIMIT 10`, [company.id]);
    
    console.log("Historical Bank Balances:");
    cashRes.rows.forEach(r => {
        console.log(`- ${r.asOfDate.toISOString().split('T')[0]}: $${r.bankBalance}`);
    });

    await client.end();
}
main().catch(console.error);
