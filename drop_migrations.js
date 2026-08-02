const { Client } = require('pg');
const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-lucky-salad-anvg05zg-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require' });
async function run() {
  await client.connect();
  await client.query('TRUNCATE TABLE _prisma_migrations;');
  console.log('Truncated _prisma_migrations');
  await client.end();
}
run().catch(console.error);
