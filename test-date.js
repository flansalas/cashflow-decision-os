const { Client } = require('pg');
async function check() {
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require"
  });
  await client.connect();
  const snap = await client.query(`SELECT "updatedAt" FROM "BaselineSnapshot" LIMIT 1`);
  console.log(snap.rows);
  await client.end();
}
check();
