const { Client } = require('pg');

async function check() {
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require"
  });
  await client.connect();

  const res = await client.query(`SELECT id FROM "Company" WHERE name ILIKE '%Cascio%' LIMIT 1`);
  if (res.rows.length === 0) {
    console.log("Cascio not found in DB!");
    process.exit(1);
  }

  const cascioId = res.rows[0].id;
  console.log("Cascio ID:", cascioId);

  const snap = await client.query(`SELECT "aiReasoningLogJson" FROM "BaselineSnapshot" WHERE "companyId" = $1 LIMIT 1`, [cascioId]);
  
  if (snap.rows.length === 0) {
    console.log("No BaselineSnapshot found!");
  } else {
    const log = snap.rows[0].aiReasoningLogJson;
    console.log("AI Log exists:", !!log);
    if (log) {
      console.log("Log Preview:", log.substring(0, 300));
    }
  }

  await client.end();
}

check().catch(console.error);
