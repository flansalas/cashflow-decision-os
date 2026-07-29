const { Client } = require('pg');

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true"
});

async function main() {
    await client.connect();
    
    const companyRes = await client.query(`SELECT id FROM "Company" WHERE name ILIKE '%Cascio%' LIMIT 1`);
    if (companyRes.rows.length === 0) return;
    
    const snapRes = await client.query(`
        SELECT note, "methodNote"
        FROM "CashSnapshot"
        WHERE "companyId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 1
    `, [companyRes.rows[0].id]);
    
    console.log(snapRes.rows[0]);
    await client.end();
}
main().catch(console.error);
