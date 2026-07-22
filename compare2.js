const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_RtnMSu28KWlm@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require' });
  await client.connect();
  const cid = '1a7b36f5-8fe0-4c2b-9336-8420846270b5';

  const txs = await client.query('SELECT amount, description, "txDate" as date FROM "BankTransaction" WHERE "companyId" = $1 ORDER BY "txDate" ASC', [cid]);
  const patterns = await client.query('SELECT * FROM "RecurringPattern" WHERE "companyId" = $1 AND "isIncluded" = true', [cid]);

  function mondayBefore(date, weeks) {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - (weeks * 7));
      return d;
  }
  function addDays(date, days) {
      const d = new Date(date);
      d.setDate(d.getDate() + days);
      return d;
  }
  function addWeeks(date, weeks) { return addDays(date, weeks * 7); }
  function daysBetween(date1, date2) { return Math.round((date2.getTime() - date1.getTime()) / 86400000); }

  const asOfDate = new Date('2026-07-20T04:00:00.000Z');
  const weekStart0 = mondayBefore(asOfDate, 52);

  const excluded2 = patterns.rows.map(p => {
      const typ = parseFloat(p.typicalAmount);
      const std = parseFloat(p.amountStdDev);
      const isVolatile = ['utilities', 'fuel', 'taxes', 'card_payment', 'payroll'].includes(p.category);
      const tolerance = isVolatile ? 0.5 : 0.2;
      return {
          minAmount: typ - Math.max(typ * tolerance, std * 2),
          maxAmount: typ + Math.max(typ * tolerance, std * 2),
          cadence: p.cadence,
          lastMatchedDate: null
      };
  });
  let lastPayrollMatchDate2 = null;

  let totalOutflowSum = 0;

  for (let i = 0; i < 52; i++) {
      const wStart = addWeeks(weekStart0, i);
      const wEnd = addDays(wStart, 6);

      let outflowSum = 0;

      for (const tx of txs.rows) {
          if (tx.date < wStart || tx.date > wEnd) continue;
          if (tx.amount >= 0) continue;
          
          const absAmount = Math.abs(tx.amount);
          let matchedAssumption = false;
          
          if (absAmount >= 54309 * 0.5 && absAmount <= 54309 * 1.5) {
              let canMatch = true;
              if (lastPayrollMatchDate2) {
                  const daysSince = Math.abs(daysBetween(lastPayrollMatchDate2, tx.date));
                  if (daysSince < 10) canMatch = false; 
              }
              if (canMatch) {
                  const daysDiff = Math.abs(daysBetween(tx.date, new Date('2026-07-31T04:00:00.000Z')));
                  const remainder = daysDiff % 14;
                  if (remainder <= 3 || remainder >= 11) {
                      lastPayrollMatchDate2 = tx.date;
                      matchedAssumption = true;
                  }
              }
          }

          if (matchedAssumption) continue;

          const matchedPattern = excluded2.find(p => {
              if (absAmount < p.minAmount || absAmount > p.maxAmount) return false;
              if (p.lastMatchedDate) {
                  const daysSince = Math.abs(daysBetween(p.lastMatchedDate, tx.date));
                  const cooldown = p.cadence === 'weekly' ? 5 : p.cadence === 'biweekly' ? 10 : 20;
                  if (daysSince < cooldown) return false;
              }
              return true;
          });
          if (matchedPattern) {
              matchedPattern.lastMatchedDate = tx.date;
              continue;
          }
          outflowSum += absAmount;
      }
      totalOutflowSum += outflowSum;
  }

  console.log("Script 2 (Looping exactly like baseline.ts) Variable Avg:", totalOutflowSum / 52);
  
  await client.end();
}
run().catch(console.error);
