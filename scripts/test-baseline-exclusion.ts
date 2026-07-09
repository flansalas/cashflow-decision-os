import { computeBaseline, BankTxForBaseline, RecurringPatternForBaseline } from "../src/services/baseline";

function runTests() {
    console.log("--- Baseline Exclusion Tests ---");
    let passed = 0;
    let failed = 0;

    const asOfDate = new Date("2026-07-08T00:00:00Z");
    const twoWeeksAgo = new Date(asOfDate.getTime() - 14 * 86400000);
    const tenWeeksAgo = new Date(asOfDate.getTime() - 70 * 86400000);

    const patterns: RecurringPatternForBaseline[] = [
        { merchantKey: "AWS", direction: "outflow", category: "software", isIncluded: true, typicalAmount: 1000, amountStdDev: 50 },
        { merchantKey: "Stripe", direction: "inflow", category: "sales", isIncluded: true, typicalAmount: 5000, amountStdDev: 200 },
        { merchantKey: "Google", direction: "outflow", category: "software", isIncluded: false, typicalAmount: 500, amountStdDev: 10 }
    ];

    const generateBgTxs = () => {
        const txs: BankTxForBaseline[] = [];
        for (let i=0; i<12; i++) {
            txs.push({ amount: 100, date: new Date(asOfDate.getTime() - (i*7+2)*86400000), merchantKey: "Bg Inflow" });
            txs.push({ amount: -100, date: new Date(asOfDate.getTime() - (i*7+3)*86400000), merchantKey: "Bg Outflow" });
        }
        return txs;
    };

    const runScenario = (name: string, testTxs: BankTxForBaseline[], expectedExcluded: boolean, direction: "inflow" | "outflow") => {
        const bgTxs = generateBgTxs();
        const baseResult = computeBaseline(bgTxs, patterns, asOfDate);
        
        const allTxs = [...bgTxs, ...testTxs];
        const testResult = computeBaseline(allTxs, patterns, asOfDate);

        let isExcluded = false;
        if (direction === "outflow") {
            // if test txs are excluded, outflow should be same as base
            isExcluded = testResult.variableOutflowWeekly === baseResult.variableOutflowWeekly;
        } else {
            isExcluded = testResult.variableInflowWeekly === baseResult.variableInflowWeekly;
        }

        if (isExcluded === expectedExcluded) {
            console.log(`✅ PASS: ${name}`);
            passed++;
        } else {
            console.log(`❌ FAIL: ${name} (Expected excluded: ${expectedExcluded}, but got ${isExcluded})`);
            failed++;
        }
    };

    // Scenario 1: Recurring outflow excluded (amount: -1000 matches AWS 1000 outflow)
    runScenario("Recurring outflow excluded", [
        { amount: -1000, date: twoWeeksAgo, merchantKey: "AWS" },
        { amount: -1000, date: tenWeeksAgo, merchantKey: "AWS" }
    ], true, "outflow");

    // Scenario 2: Recurring inflow excluded (amount: 5000 matches Stripe 5000 inflow)
    runScenario("Recurring inflow excluded", [
        { amount: 5000, date: twoWeeksAgo, merchantKey: "Stripe" },
        { amount: 5000, date: tenWeeksAgo, merchantKey: "Stripe" }
    ], true, "inflow");

    // Scenario 3: Same merchant but exceptional amount retained
    runScenario("Same merchant but exceptional amount retained", [
        { amount: -5000, date: twoWeeksAgo, merchantKey: "AWS" }, // 5000 is way outside 1000 +/- 30%
        { amount: -5000, date: tenWeeksAgo, merchantKey: "AWS" }
    ], false, "outflow");

    // Scenario 4: Same merchant and amount but opposite direction retained
    runScenario("Same merchant and amount but opposite direction retained", [
        { amount: 1000, date: twoWeeksAgo, merchantKey: "AWS" }, // Positive 1000, but AWS pattern is outflow
        { amount: 1000, date: tenWeeksAgo, merchantKey: "AWS" }
    ], false, "inflow");

    // Scenario 5: Non-included pattern retained in baseline
    runScenario("Non-included pattern retained in baseline", [
        { amount: -500, date: twoWeeksAgo, merchantKey: "Google" }, // Matches amount and direction, but isIncluded=false
        { amount: -500, date: tenWeeksAgo, merchantKey: "Google" }
    ], false, "outflow");

    console.log(`\nTests: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);
}

runTests();
