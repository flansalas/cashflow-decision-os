import { computeBaseline, type BankTxForBaseline, type RecurringPatternForBaseline, type BaselineAssumptions } from "../src/services/baseline";

const asOfDate = new Date("2026-07-01T12:00:00Z");

function createBaseTxs(): BankTxForBaseline[] {
    const txs: BankTxForBaseline[] = [];
    const baseDate = new Date("2026-04-06T12:00:00Z"); // Start of Week 0
    for (let i = 0; i < 6; i++) {
        const d = new Date(baseDate);
        d.setDate(d.getDate() + i * 7 + 2); // Wednesday of each week
        txs.push({
            merchantKey: "Background Outflow",
            amount: -10.00,
            date: d
        });
        txs.push({
            merchantKey: "Background Inflow",
            amount: 100.00,
            date: d
        });
    }
    return txs;
}

const defaultPatterns: RecurringPatternForBaseline[] = [
    {
        merchantKey: "Netflix",
        direction: "outflow",
        category: "software",
        isIncluded: true,
        typicalAmount: 15.99,
        amountStdDev: 0
    },
    {
        merchantKey: "National Grid",
        direction: "outflow",
        category: "utilities",
        isIncluded: true,
        typicalAmount: 100,
        amountStdDev: 10
    },
    {
        merchantKey: "Acme Corp Revenue",
        direction: "inflow",
        category: "sales",
        isIncluded: true,
        typicalAmount: 5000,
        amountStdDev: 100
    }
];

const defaultAssumptions: BaselineAssumptions = {
    payrollAllInAmount: 10000,
    payrollNextDate: new Date("2026-07-15T12:00:00Z"),
    payrollCadence: "biweekly",
    rentMonthlyAmount: 2000,
    rentDayOfMonth: 1
};

let exitCode = 0;

function runTest(
    name: string,
    txs: BankTxForBaseline[],
    patterns: RecurringPatternForBaseline[],
    assumptions: BaselineAssumptions | undefined,
    assertion: (result: any) => boolean
) {
    try {
        const result = computeBaseline(txs, patterns, asOfDate, assumptions);
        if (assertion(result)) {
            console.log(`PASS: ${name}`);
        } else {
            console.error(`FAIL: ${name}`);
            console.error(`  Got:`, result);
            exitCode = 1;
        }
    } catch (e) {
        console.error(`FAIL: ${name}`);
        console.error(`  Error thrown:`, e);
        exitCode = 1;
    }
}

console.log("Starting Slice 2A Final Test Verification...\n");

// 1. Variable utility amount inside tolerance is excluded
// tolerance is 50% for utilities. typicalAmount is 100. Bounds: 50 to 150.
// Tx amount is -140 (within tolerance). Result should exclude it.
// Expected outflow: 10.00
runTest(
    "variable utility amount inside tolerance is excluded",
    [
        ...createBaseTxs(),
        { merchantKey: "National Grid", amount: -140, date: new Date("2026-06-17T12:00:00Z") }
    ],
    defaultPatterns,
    undefined,
    (res) => res.variableOutflowWeekly === 10.00
);

// 2. Variable utility amount outside tolerance remains in baseline
// Tx amount is -160 (outside tolerance). Result should include/leak it.
// It will be clipped to 25.
// Expected outflow: 13.95
runTest(
    "variable utility amount outside tolerance remains in baseline",
    [
        ...createBaseTxs(),
        { merchantKey: "National Grid", amount: -160, date: new Date("2026-06-17T12:00:00Z") }
    ],
    defaultPatterns,
    undefined,
    (res) => res.variableOutflowWeekly === 13.95
);

// 3. Unrelated transaction with similar merchant text remains in baseline
// Pattern is "Netflix" (outflow). Tx is "Netflix Refund" (inflow).
// It should leak into the inflow baseline.
// Expected inflow: 77.89
runTest(
    "unrelated transaction with similar merchant text remains in baseline",
    [
        ...createBaseTxs(),
        { merchantKey: "Netflix Refund", amount: 15.99, date: new Date("2026-06-17T12:00:00Z") }
    ],
    defaultPatterns,
    undefined,
    (res) => res.variableInflowWeekly === 77.89
);

// 4. Payroll assumption transaction matching date/category/direction/amount is excluded
// Assumptions: payroll 10000, next date 2026-07-15, biweekly.
// Tx is Gusto Payroll (matches payroll category), amount -10100 (within ±20%), date 2026-06-17 (28 days prior, matches biweekly).
// Expected outflow: 10.00
runTest(
    "payroll assumption transaction matching date/category/direction/amount is excluded",
    [
        ...createBaseTxs(),
        { merchantKey: "Gusto Payroll", amount: -10100, date: new Date("2026-06-17T12:00:00Z") }
    ],
    [],
    defaultAssumptions,
    (res) => res.variableOutflowWeekly === 10.00
);

// 5. Payroll transaction outside date tolerance remains in baseline
// Tx is on 2026-06-23 (22 days before 2026-07-15. Remainder 22 % 14 = 8, outside ±3 days).
// Expected outflow: 13.95 (clipped to 25)
runTest(
    "payroll transaction outside date tolerance remains in baseline",
    [
        ...createBaseTxs(),
        { merchantKey: "Gusto Payroll", amount: -10100, date: new Date("2026-06-23T12:00:00Z") }
    ],
    [],
    defaultAssumptions,
    (res) => res.variableOutflowWeekly === 13.95
);

// 6. Rent assumption transaction matching date/category/direction/amount is excluded
// Assumptions: rent monthly 2000, day 1.
// Tx is Property Mgmt (matches rent category), amount -2100 (within ±20%), date 2026-06-02 (day 2 is within ±3 of day 1).
// Expected outflow: 10.00
runTest(
    "rent assumption transaction matching date/category/direction/amount is excluded",
    [
        ...createBaseTxs(),
        { merchantKey: "Property Mgmt", amount: -2100, date: new Date("2026-06-02T12:00:00Z") }
    ],
    [],
    defaultAssumptions,
    (res) => res.variableOutflowWeekly === 10.00
);

// 7. Recurring inflow is excluded from variable inflow baseline
// Pattern is Acme Corp Revenue (inflow, typical 5000).
// Tx is 5050 (within ±20%).
// Expected inflow: 100.00
runTest(
    "recurring inflow is excluded from variable inflow baseline",
    [
        ...createBaseTxs(),
        { merchantKey: "Acme Corp Revenue", amount: 5050.00, date: new Date("2026-06-17T12:00:00Z") }
    ],
    defaultPatterns,
    undefined,
    (res) => res.variableInflowWeekly === 100.00
);

// 8. Recurring outflow is excluded from variable outflow baseline
// Pattern is Netflix (typical 15.99). Tx is -15.99.
// Expected outflow: 10.00
runTest(
    "recurring outflow is excluded from variable outflow baseline",
    [
        ...createBaseTxs(),
        { merchantKey: "Netflix", amount: -15.99, date: new Date("2026-06-17T12:00:00Z") }
    ],
    defaultPatterns,
    undefined,
    (res) => res.variableOutflowWeekly === 10.00
);

// 9. Far-out amount is not excluded
// Pattern is Netflix (typical 15.99). Tx is -50.00 (outside ±20% for stable categories).
// Expected outflow: 13.95 (clipped to 25)
runTest(
    "far-out amount is not excluded",
    [
        ...createBaseTxs(),
        { merchantKey: "Netflix", amount: -50.00, date: new Date("2026-06-17T12:00:00Z") }
    ],
    defaultPatterns,
    undefined,
    (res) => res.variableOutflowWeekly === 13.95
);

// 10. Description variation still matches correctly
// Pattern is Netflix. Tx is "ACH NETFLIX" (should normalize to "netflix" and match).
// Expected outflow: 10.00
runTest(
    "description variation still matches correctly",
    [
        ...createBaseTxs(),
        { merchantKey: "ACH NETFLIX", amount: -15.99, date: new Date("2026-06-17T12:00:00Z") }
    ],
    defaultPatterns,
    undefined,
    (res) => res.variableOutflowWeekly === 10.00
);

// 11. No-match transaction remains in baseline
// Tx is "Random Coffee Shop", amount -15.00 (not matched by anything).
// Outflows leaked: background 10s + new 15. Weighted mean: 11.32.
runTest(
    "no-match transaction remains in baseline",
    [
        ...createBaseTxs(),
        { merchantKey: "Random Coffee Shop", amount: -15.00, date: new Date("2026-06-17T12:00:00Z") }
    ],
    defaultPatterns,
    undefined,
    (res) => res.variableOutflowWeekly === 11.32
);

console.log(`\nVerification finished with exit code ${exitCode}`);
process.exit(exitCode);
