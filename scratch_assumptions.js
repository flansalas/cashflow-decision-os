const { Client } = require('pg');

const client = new Client({
  connectionString: "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true"
});

async function main() {
    await client.connect();

    const companyRes = await client.query(`SELECT id, name FROM "Company" WHERE name ILIKE '%Cascio%' LIMIT 1`);
    if (companyRes.rows.length === 0) return;
    const company = companyRes.rows[0];

    const assumptionsRes = await client.query(`SELECT * FROM "Assumption" WHERE "companyId" = $1`, [company.id]);
    console.log("Assumptions:");
    console.log(assumptionsRes.rows);

    const recurringRes = await client.query(`SELECT "displayName", "typicalAmount", "isIncluded" FROM "RecurringPattern" WHERE "companyId" = $1 AND "isIncluded" = true`, [company.id]);
    console.log("\nIncluded Recurring Patterns:");
    console.log(recurringRes.rows);

    await client.end();
}
main().catch(console.error);
