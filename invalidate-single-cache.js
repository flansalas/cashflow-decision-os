const { Client } = require('pg');

async function invalidateSingle() {
  const companyId = '1a7b36f5-8fe0-4c2b-9336-8420846270b5';
  
  const client = new Client({
    connectionString: "postgresql://neondb_owner:npg_yN4JPm5dQLiv@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require"
  });
  
  try {
    await client.connect();

    // 1. Fetch the old updatedAt value
    const selectRes = await client.query(`SELECT "updatedAt" FROM "BaselineSnapshot" WHERE "companyId" = $1`, [companyId]);
    
    if (selectRes.rows.length === 0) {
      console.log(`No snapshot found for company: ${companyId}`);
      return;
    }
    
    const oldUpdatedAt = selectRes.rows[0].updatedAt;

    // 2. Update to a date in the past
    const newDateStr = '2000-01-01T00:00:00Z';
    const updateRes = await client.query(
      `UPDATE "BaselineSnapshot" SET "updatedAt" = $1 WHERE "companyId" = $2 RETURNING "updatedAt"`, 
      [newDateStr, companyId]
    );

    const newUpdatedAt = updateRes.rows[0].updatedAt;

    // 3. Report
    console.log(JSON.stringify({
      affectedRows: updateRes.rowCount,
      oldUpdatedAt: oldUpdatedAt,
      newUpdatedAt: newUpdatedAt
    }, null, 2));

  } catch (err) {
    console.error("Database operation failed:", err);
  } finally {
    await client.end();
  }
}

invalidateSingle();
