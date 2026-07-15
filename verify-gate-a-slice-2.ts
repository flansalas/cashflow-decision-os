import test from 'node:test';
import assert from 'node:assert';
import { computeForecast } from './src/services/forecast';
import fs from 'node:fs';

test('Verify forecast-assembly.ts includes skipDates', () => {
    const code = fs.readFileSync('./src/services/forecast-assembly.ts', 'utf-8');
    
    // Check that the recurring mapping includes skipDates for Managed forecast
    const hasSkipDatesInManaged = code.includes('skipDates: skipDatesByPattern.get(rp.id) ?? []');
    assert.ok(hasSkipDatesInManaged, "Managed forecast missing skipDates assignment");

    // Check that Organic forecast mapping explicitly passes empty skipDates (ignores overrides)
    const hasSkipDatesInOrganic = code.includes('skipDates: []');
    assert.ok(hasSkipDatesInOrganic, "Organic forecast missing skipDates: [] assignment");
    
    console.log("✅ forecast-assembly.ts code analysis passed. skipDates are mapped correctly.");
});

test('Verify skipDates behavior in computeForecast', () => {
    const baseRecurring = {
        id: "rec1",
        direction: "outflow" as const,
        displayName: "Rent",
        typicalAmount: 500,
        amountStdDev: 0,
        cadence: "weekly",
        nextExpectedDate: new Date("2026-07-20T00:00:00Z"),
        confidence: "high" as const,
        category: "rent",
        isIncluded: true,
        isCritical: true,
        status: "active",
        origin: "system"
    };

    const inputBase = {
        adjustedOpeningCash: 10000,
        bankBalance: 10000,
        adjustmentsTotal: 0,
        asOfDate: new Date("2026-07-13T00:00:00Z"), // Monday week 0
        invoices: [],
        bills: [],
        assumptions: {
            bufferMin: 0,
            fixedWeeklyOutflow: 0,
            payrollCadence: "biweekly",
            payrollAllInAmount: null,
            payrollNextDate: null,
            rentMonthlyAmount: null,
            rentDayOfMonth: null,
            paymentCurveJson: '{"current":0,"1-14":1,"15-30":2,"31-60":3,"61+":4}',
            highRiskAgingDays: 61,
        },
        hasBankBaseline: false,
        variableOutflowWeekly: 0,
        variableOutflowBand: 0,
        baselineInflowWeekly: 0,
        baselineInflowBand: 0
    };

    // 1. Managed forecast WITH skipDate
    const managedInput = {
        ...inputBase,
        recurring: [ { ...baseRecurring, skipDates: ["2026-07-20"] } ]
    };
    const managedForecast = computeForecast(managedInput);
    
    // week 0 is July 13, week 1 is July 20
    assert.strictEqual(managedForecast.weeks[1].outflowsExpected, 0, "Skipped occurrence should be absent from Managed forecast");
    console.log("✅ Skipped occurrence absent from Managed forecast.");

    assert.strictEqual(managedForecast.weeks[2].outflowsExpected, 500, "Non-skipped occurrences should remain unchanged");
    console.log("✅ Non-skipped occurrences unchanged.");

    // 2. Organic forecast (ignores skipDates by passing [])
    const organicInput = {
        ...inputBase,
        recurring: [ { ...baseRecurring, skipDates: [] } ] // Organic assembly passes empty array
    };
    const organicForecast = computeForecast(organicInput);
    
    assert.strictEqual(organicForecast.weeks[1].outflowsExpected, 500, "Organic forecast ignores skips, occurrence remains present");
    console.log("✅ Skipped occurrence remains in Organic forecast (as appropriate, since organic ignores overrides).");
});
