const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: 'postgresql://neondb_owner:npg_RtnMSu28KWlm@ep-plain-truth-anxarbfz-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require' });
  await client.connect();
  const cid = '1a7b36f5-8fe0-4c2b-9336-8420846270b5';

  const txs = await client.query('SELECT amount, description, "txDate" FROM "BankTransaction" WHERE "companyId" = $1 ORDER BY "txDate" ASC', [cid]);
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
  const asOfDate = new Date('2026-07-20T04:00:00.000Z');
  const weekStart0 = mondayBefore(asOfDate, 52);
  const endLimit = new Date(weekStart0);
  endLimit.setDate(endLimit.getDate() + (52 * 7));

  // Filter txs to EXACTLY 52 weeks
  const filteredTxs = txs.rows.filter(tx => tx.txDate >= weekStart0 && tx.txDate < endLimit);

  // SCRIPT 1 LOGIC (String maxAmount bug)
  let total1 = 0;
  const excluded1 = patterns.rows.map(p => {
      const isVolatile = ['utilities', 'fuel', 'taxes', 'card_payment', 'payroll'].includes(p.category);
      const tolerance = isVolatile ? 0.5 : 0.2;
      return {
          minAmount: p.typicalAmount - Math.max(p.typicalAmount * tolerance, p.amountStdDev * 2),
          maxAmount: p.typicalAmount + Math.max(p.typicalAmount * tolerance, p.amountStdDev * 2),
          cadence: p.cadence,
          lastMatchedDate: null
      };
  });
  let lastPayrollMatchDate1 = null;

  for (const tx of filteredTxs) {
      if (tx.amount >= 0) continue;
      const absAmount = Math.abs(tx.amount);
      let matched = false;
      const pMatch = excluded1.find(p => {
          if (absAmount < p.minAmount || absAmount > p.maxAmount) return false;
          if (p.lastMatchedDate) {
              const daysSince = Math.abs((tx.txDate - p.lastMatchedDate) / 86400000);
              const cooldown = p.cadence === 'weekly' ? 5 : p.cadence === 'biweekly' ? 10 : 20;
              if (daysSince < cooldown) return false;
          }
          return true;
      });
      if (pMatch) { pMatch.lastMatchedDate = tx.txDate; matched = true; }
      else {
          if (absAmount >= 54309 * 0.5 && absAmount <= 54309 * 1.5) {
              let canMatch = true;
              if (lastPayrollMatchDate1) {
                  const daysSince = Math.abs((tx.txDate - lastPayrollMatchDate1) / 86400000);
                  if (daysSince < 5) canMatch = false; // Script 1 used 5 (weekly)
              }
              if (canMatch) {
                  lastPayrollMatchDate1 = tx.txDate;
                  matched = true;
              }
          }
      }
      if (!matched) total1 += absAmount;
  }

  // SCRIPT 2 LOGIC (baseline.ts exact)
  let total2 = 0;
  const excluded2 = patterns.rows.map(p => {
      const typ = parseFloat(p.typicalAmount); // Number!
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

  for (const tx of filteredTxs) {
      if (tx.amount >= 0) continue;
      const absAmount = Math.abs(tx.amount);
      let matched = false;
      
      // Payroll first
      if (absAmount >= 54309 * 0.5 && absAmount <= 54309 * 1.5) {
          let canMatch = true;
          if (lastPayrollMatchDate2) {
              const daysSince = Math.abs((tx.txDate - lastPayrollMatchDate2) / 86400000);
              if (daysSince < 10) canMatch = false; // baseline uses biweekly (10)
          }
          if (canMatch) {
              // REMAINDER LOGIC!
              const daysDiff = Math.abs((tx.txDate - new Date('2026-07-31T04:00:00.000Z')) / 86400000);
              const remainder = daysDiff % 14;
              if (remainder <= 3 || remainder >= 11) {
                  lastPayrollMatchDate2 = tx.txDate;
                  matched = true;
              }
          }
      }

      if (!matched) {
          const pMatch = excluded2.find(p => {
              if (absAmount < p.minAmount || absAmount > p.maxAmount) return false;
              if (p.lastMatchedDate) {
                  const daysSince = Math.abs((tx.txDate - p.lastMatchedDate) / 86400000);
                  const cooldown = p.cadence === 'weekly' ? 5 : p.cadence === 'biweekly' ? 10 : 20;
                  if (daysSince < cooldown) return false;
              }
              return true;
          });
          if (pMatch) {
              pMatch.lastMatchedDate = tx.txDate;
              matched = true;
          }
      }
      
      if (!matched) {
          total2 += absAmount;
      }
  }

  console.log("Script 1 Variable Avg:", total1 / 52);
  console.log("Script 2 Variable Avg:", total2 / 52);
  
  await client.end();
}
run().catch(console.error);
