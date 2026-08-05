const { Client } = require('pg');

async function main() {
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-lucky-salad-anvg05zg-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require",
  });

  try {
    await client.connect();
    const syntheticId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb";

    const baseline = await client.query('SELECT * FROM "BaselineSnapshot" WHERE "companyId" = $1', [syntheticId]);
    console.log(`BaselineSnapshot count: ${baseline.rowCount}`);

  } catch (e) {
    console.error("Connection failed:", e);
  } finally {
    await client.end();
  }
}

main();
