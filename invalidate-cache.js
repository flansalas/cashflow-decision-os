const { Client } = require('pg');

async function invalidate() {
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require"
  });
  await client.connect();

  const res = await client.query(`UPDATE "BaselineSnapshot" SET "updatedAt" = '2000-01-01T00:00:00Z'`);
  console.log(`Invalidated ${res.rowCount} baseline snapshots.`);

  await client.end();
}

invalidate().catch(console.error);
