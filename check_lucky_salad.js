const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-lucky-salad-anvg05zg-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require' });
async function run() {
  await client.connect();
  const res = await client.query(`SELECT COUNT(*) FROM "BankTransaction" WHERE "companyId" = '1a7b36f5-8fe0-4c2b-9336-8420846270b5'`);
  console.log('Count:', res.rows[0].count);
  await client.end();
}
run().catch(console.error);
