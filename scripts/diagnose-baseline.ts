// diagnostic: check baseline computation for all companies
// Run with: npx tsx scripts/diagnose-baseline.ts
import "../src/db/prisma"; // ensure adapter is initialized
import prisma from "../src/db/prisma";
import { computeBaseline, type BankTxForBaseline, type RecurringPatternForBaseline } from "../src/services/baseline";

async function main() {
    const companies = await prisma.company.findMany({ select: { id: true, name: true } });

    for (const company of companies) {
        console.log("\n" + "=".repeat(70));
        console.log(`COMPANY: ${company.name} (${company.id})`);
        console.log("=".repeat(70));

        const [bankTxs, recurringPatterns, cashSnapshot] = await Promise.all([
            prisma.bankTransaction.findMany({
                where: {
                    companyId: company.id,
                    txDate: { gte: new Date(Date.now() - 84 * 86_400_000) },
                },
                select: { amount: true, txDate: true, description: true, direction: true },
                orderBy: { txDate: "desc" },
            }),
            prisma.recurringPattern.findMany({ where: { companyId: company.id } }),
            prisma.cashSnapshot.findFirst({ where: { companyId: company.id }, orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }] }),
        ]);

        console.log(`  Bank transactions (last 84 days): ${bankTxs.length}`);
        console.log(`  Recurring patterns: ${recurringPatterns.length}`);
        console.log(`  Cash snapshot date: ${cashSnapshot?.asOfDate}`);

        if (bankTxs.length === 0) {
            console.log("  WARNING: NO BANK TRANSACTIONS — baseline will be placeholder (0)");
            continue;
        }

        // Show sample of transactions
        console.log("\n  Sample bank transactions (most recent 10):");
        bankTxs.slice(0, 10).forEach(tx => {
            console.log(`    [${tx.direction}] $${Number(tx.amount).toLocaleString()} — "${tx.description}" on ${new Date(tx.txDate).toLocaleDateString()}`);
        });

        // Show weekly distribution
        const asOf = cashSnapshot?.asOfDate ?? new Date();
        const weekBuckets: Record<string, { inflow: number; outflow: number; count: number }> = {};
        for (const tx of bankTxs) {
            const d = new Date(tx.txDate);
            const weeksAgo = Math.ceil((asOf.getTime() - d.getTime()) / (7 * 86_400_000));
            const weekKey = `W-${weeksAgo}`;
            if (!weekBuckets[weekKey]) weekBuckets[weekKey] = { inflow: 0, outflow: 0, count: 0 };
            if (tx.direction === "inflow") weekBuckets[weekKey].inflow += Number(tx.amount);
            else weekBuckets[weekKey].outflow += Number(tx.amount);
            weekBuckets[weekKey].count++;
        }
        console.log("\n  Weekly bank activity (past weeks):");
        Object.entries(weekBuckets).sort().slice(0, 12).forEach(([wk, b]) => {
            console.log(`    ${wk}: IN=$${Math.round(b.inflow).toLocaleString()} OUT=$${Math.round(b.outflow).toLocaleString()} (${b.count} txs)`);
        });

        // Show recurring patterns that will be excluded
        const patternsForBaseline: RecurringPatternForBaseline[] = recurringPatterns.map(rp => ({
            merchantKey: (rp.merchantKey ?? rp.displayName) as string,
            direction: rp.direction,
            category: rp.category,
            isIncluded: rp.isIncluded,
            typicalAmount: rp.typicalAmount,
            amountStdDev: rp.amountStdDev,
        }));

        console.log("\n  Recurring patterns (excluded from variable baseline):");
        patternsForBaseline.filter(p => p.isIncluded).forEach(p => {
            console.log(`    [${p.direction}] "${p.merchantKey}" — $${Number(p.typicalAmount).toLocaleString()} (${p.category})`);
        });

        // Run baseline
        const bankTxsForBaseline: BankTxForBaseline[] = bankTxs.map(tx => ({
            amount: tx.direction === "inflow" ? Number(tx.amount) : -Number(tx.amount),
            date: new Date(tx.txDate),
            merchantKey: (tx.description as string) ?? "",
        }));

        const baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, new Date(asOf));

        console.log("\n  ───── BASELINE RESULT ─────");
        console.log(`  hasSufficientHistory  : ${baseline.hasSufficientHistory}`);
        console.log(`  baselineConfidenceTier: ${baseline.baselineConfidenceTier}`);
        console.log(`  weeksAnalyzed         : ${baseline.weeksAnalyzed}`);
        console.log(`  variableInflowWeekly  : $${Math.round(baseline.variableInflowWeekly).toLocaleString()}`);
        console.log(`  variableOutflowWeekly : $${Math.round(baseline.variableOutflowWeekly).toLocaleString()}`);
        console.log(`  note: ${baseline.note}`);

        if (!baseline.hasSufficientHistory) {
            console.log("\n  BLOCKED: hasSufficientHistory=false — not enough active weeks");
        } else if (baseline.variableInflowWeekly === 0) {
            console.log("\n  BLOCKED: variableInflowWeekly=0 — all inflow transactions were filtered out as recurring");
        } else {
            console.log(`\n  OK: projections will fill inflow gap up to $${Math.round(baseline.variableInflowWeekly).toLocaleString()}/week`);
        }
    }

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
