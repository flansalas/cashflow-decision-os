const { Pool } = require('pg');

async function check() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("No DATABASE_URL");
    console.log('Runtime DATABASE_URL endpoint:', url.match(/@(ep-[a-z-]+-[a-z0-9]+)/)?.[1] || url);

    const pool = new Pool({ connectionString: url });
    try {
        const res = await pool.query(`SELECT id, "clerkOrgId" FROM "Company" WHERE id = 'bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb'`);
        console.log('Company Mapping:', res.rows[0]);
    } finally {
        await pool.end();
    }
}
check().catch(console.error);
