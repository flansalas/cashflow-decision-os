const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_RtnMSu28KWlm@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require' });
  await client.connect();
  const cid = '1a7b36f5-8fe0-4c2b-9336-8420846270b5';

  const txs = await client.query('SELECT amount, "txDate" FROM "BankTransaction" WHERE "companyId" = $1 ORDER BY "txDate" ASC', [cid]);

  function mondayBefore(date, weeks) {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (weeks * 7));
      return d;
  }

  const asOfDate = new Date('2026-07-20T04:00:00.000Z');
  const weekStart0 = mondayBefore(asOfDate, 52);
  const endLimit = new Date(weekStart0);
  endLimit.setDate(endLimit.getDate() + (52 * 7));

  let totalOutflow = 0;
  for (const tx of txs.rows) {
      if (tx.amount >= 0) continue;
      if (tx.txDate < weekStart0 || tx.txDate >= endLimit) continue;
      totalOutflow += Math.abs(tx.amount);
  }

  console.log("Total Outflow 52 weeks:", totalOutflow);
  console.log("Average:", totalOutflow / 52);
  
  await client.end();
}
run().catch(console.error);
