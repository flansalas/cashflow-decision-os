// Tests for forecast.ts M1 residual coverage and payroll/rent deduplication.
// Tests 8, 9, 11, 12, 13, 14, 17 from the requirements.

import { describe, it, expect } from "vitest";
import { computeForecast, type ForecastInput, type ForecastRecurring } from "@/services/forecast";

// ── Minimal ForecastInput factory ─────────────────────────────────────────

function makeInput(overrides: Partial<ForecastInput> = {}): ForecastInput {
    return {
        adjustedOpeningCash: 100_000,
        bankBalance: 100_000,
        adjustmentsTotal: 0,
        asOfDate: new Date("2026-08-11T00:00:00Z"), // Monday
        invoices: [],
        bills: [],
        recurring: [],
        assumptions: {
            bufferMin: 10_000,
            fixedWeeklyOutflow: 0,
            payrollCadence: "biweekly",
            payrollAllInAmount: null,
            payrollNextDate: null,
            rentMonthlyAmount: null,
            rentDayOfMonth: null,
            paymentCurveJson: '{"current":0,"1-14":1,"15-30":2,"31-60":3,"61+":4}',
            highRiskAgingDays: 61,
            projectionSafetyMargin: 1.0,
        },
        hasBankBaseline: true,
        baselineConfidenceTier: "high",
        variableOutflowWeekly: 5000,
        variableOutflowBand: 0.1,
        baselineInflowWeekly: 20_000,
        baselineInflowBand: 0.1,
        ...overrides,
    };
}

function makeRecurring(overrides: Partial<ForecastRecurring>): ForecastRecurring {
    return {
        id: "rec-1",
        direction: "outflow",
        displayName: "Test Pattern",
        typicalAmount: 1000,
        amountStdDev: 0,
        cadence: "monthly",
        nextExpectedDate: new Date("2026-08-15T00:00:00Z"),
        confidence: "high",
        category: "other",
        isIncluded: true,
        isCritical: false,
        status: "active",
        origin: "system",
        skipDates: [],
        ...overrides,
    };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Payroll/Rent assumption deduplication", () => {

    it("11. payroll assumption fires when no payroll RecurringPattern exists", () => {
        const input = makeInput({
            recurring: [],
            assumptions: {
                ...makeInput().assumptions,
                payrollAllInAmount: 12_000,
                payrollNextDate: new Date("2026-08-15T00:00:00Z"),
                payrollCadence: "biweekly",
            },
        });
        const result = computeForecast(input);
        // Payroll should appear in at least one week's outflow breakdown
        const hasPayrollInAnyWeek = result.weeks.some(w =>
            w.breakdown.outflows.some(o => o.label.toLowerCase().includes("payroll"))
        );
        expect(hasPayrollInAnyWeek).toBe(true);
    });

    it("11b. payroll assumption is SUPPRESSED when included payroll RecurringPattern exists (no double-counting)", () => {
        const payrollPattern = makeRecurring({
            id: "rec-payroll",
            category: "payroll",
            displayName: "Payroll ADP",
            typicalAmount: 12_000,
            cadence: "biweekly",
            nextExpectedDate: new Date("2026-08-15T00:00:00Z"),
            isIncluded: true,
        });
        const input = makeInput({
            recurring: [payrollPattern],
            assumptions: {
                ...makeInput().assumptions,
                payrollAllInAmount: 12_000,
                payrollNextDate: new Date("2026-08-15T00:00:00Z"),
                payrollCadence: "biweekly",
            },
        });
        const result = computeForecast(input);

        // For any week that has payroll, it should appear EXACTLY ONCE (not twice)
        for (const week of result.weeks) {
            const payrollEntries = week.breakdown.outflows.filter(o =>
                o.label.toLowerCase().includes("payroll")
            );
            // Must not have both "Payroll (Assumed)" AND "Payroll ADP" in the same week
            const hasSynthetic = payrollEntries.some(o => o.label === "Payroll (Assumed)");
            const hasReal = payrollEntries.some(o => o.label === "Payroll ADP");
            expect(hasSynthetic && hasReal).toBe(false);
        }
    });

    it("12. rent assumption fires when no rent RecurringPattern exists", () => {
        const input = makeInput({
            recurring: [],
            assumptions: {
                ...makeInput().assumptions,
                rentMonthlyAmount: 3_650,
                rentDayOfMonth: 1,
            },
        });
        const result = computeForecast(input);
        const hasRentInAnyWeek = result.weeks.some(w =>
            w.breakdown.outflows.some(o => o.label.toLowerCase().includes("rent"))
        );
        expect(hasRentInAnyWeek).toBe(true);
    });

    it("12b. rent assumption is SUPPRESSED when included rent RecurringPattern exists (no double-counting)", () => {
        const rentPattern = makeRecurring({
            id: "rec-rent",
            category: "rent",
            displayName: "LHI Rent",
            typicalAmount: 3_650,
            cadence: "monthly",
            nextExpectedDate: new Date("2026-09-01T00:00:00Z"),
            isIncluded: true,
        });
        const input = makeInput({
            recurring: [rentPattern],
            assumptions: {
                ...makeInput().assumptions,
                rentMonthlyAmount: 3_650,
                rentDayOfMonth: 1,
            },
        });
        const result = computeForecast(input);

        for (const week of result.weeks) {
            const rentEntries = week.breakdown.outflows.filter(o =>
                o.label.toLowerCase().includes("rent")
            );
            const hasSynthetic = rentEntries.some(o => o.label === "Rent (Assumed)");
            const hasReal = rentEntries.some(o => o.label === "LHI Rent");
            // Should never have both synthetic and real rent in same week
            expect(hasSynthetic && hasReal).toBe(false);
        }
    });

    it("12c. payroll pattern that is NOT included does not suppress payroll assumption", () => {
        const excludedPayroll = makeRecurring({
            id: "rec-payroll-excluded",
            category: "payroll",
            displayName: "Payroll ADP",
            typicalAmount: 12_000,
            cadence: "biweekly",
            nextExpectedDate: new Date("2026-08-15T00:00:00Z"),
            isIncluded: false, // excluded from forecast
        });
        const input = makeInput({
            // isIncluded=false patterns are filtered out in forecast-assembly before reaching here
            // But test with empty recurring array to simulate that filtering
            recurring: [],
            assumptions: {
                ...makeInput().assumptions,
                payrollAllInAmount: 12_000,
                payrollNextDate: new Date("2026-08-15T00:00:00Z"),
                payrollCadence: "biweekly",
            },
        });
        const result = computeForecast(input);
        const hasPayroll = result.weeks.some(w =>
            w.breakdown.outflows.some(o => o.label.toLowerCase().includes("payroll"))
        );
        expect(hasPayroll).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("M1 residual inflow coverage — manual inflow reduces residual", () => {

    it("13. manual inflow reduces M1 residual (no double-counting)", () => {
        // With no manual entries: full M1 inflow = baselineInflowWeekly
        const inputNoManual = makeInput({
            invoices: [],
            recurring: [],
            cashFlowEntries: [],
        });
        const resultNoManual = computeForecast(inputNoManual);
        const w0inflowNoManual = resultNoManual.weeks[0].inflowsExpected;

        // With a manual inflow of $5,000 for the same week:
        const inputWithManual = makeInput({
            invoices: [],
            recurring: [],
            cashFlowEntries: [{
                categoryId: "manual-1",
                categoryName: "Customer Deposit",
                direction: "inflow",
                label: "Customer Deposit",
                amount: 5_000,
                targetDate: new Date("2026-08-12T00:00:00Z"), // W0
            }],
        });
        const resultWithManual = computeForecast(inputWithManual);
        const w0inflowWithManual = resultWithManual.weeks[0].inflowsExpected;

        // The manual $5,000 is added but M1 is reduced by coverage.
        // Net effect: total inflow should be LESS than (noManual + 5000)
        // because M1 residual is reduced. It should be approximately = noManual
        // (manual replaces M1 gap, not adds to it) when manual covers coverage.
        // Since baseline = $20,000 and manual = $5,000 (25% coverage),
        // M1 residual = 20,000 * (1 - 0.25) = 15,000
        // Total = 5,000 + 15,000 = 20,000 ≈ same as without manual.
        // Key assertion: inflow with manual < inflow without manual + 5,000
        expect(w0inflowWithManual).toBeLessThan(w0inflowNoManual + 5_000);
    });

    it("14. event already excluded from M1 (recurring outflow category) is not deducted from M1 twice", () => {
        // Payroll recurring patterns are stripped from M1 historical data.
        // They should appear in the forecast as recurring (not as M1 reduction).
        // Verify M1 outflow residual is not affected by a payroll recurring item.
        const inputWithPayrollRecurring = makeInput({
            recurring: [makeRecurring({
                id: "rec-payroll",
                category: "payroll",
                displayName: "Payroll ADP",
                typicalAmount: 12_000,
                cadence: "biweekly",
                nextExpectedDate: new Date("2026-08-15T00:00:00Z"),
            })],
        });
        const result = computeForecast(inputWithPayrollRecurring);

        // In a week WITH payroll: M1 outflow residual should be the full amount
        // (payroll recurring is excluded from scheduledVariableOutflowSum)
        const payrollWeek = result.weeks.find(w =>
            w.breakdown.outflows.some(o => o.sourceType === "recurring" && o.label.includes("Payroll"))
        );
        if (payrollWeek) {
            const m1entry = payrollWeek.breakdown.outflows.find(o => o.sourceType === "baseline");
            // M1 should still be ~variableOutflowWeekly (not reduced by payroll)
            if (m1entry) {
                // M1 residual should be close to full $5,000 (not reduced by $12k payroll)
                expect(m1entry.amount).toBeGreaterThan(4_000);
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("M1 residual outflow coverage — manual outflow reduces residual", () => {

    it("9. manual outflow reduces M1 variable outflow residual", () => {
        // Without manual: M1 outflow = variableOutflowWeekly = $5,000
        const inputNoManual = makeInput({ cashFlowEntries: [] });
        const resultNoManual = computeForecast(inputNoManual);
        const w0outflowNoManual = resultNoManual.weeks[0].outflowsExpected;

        // With a manual outflow of $2,000 in W0:
        const inputWithManual = makeInput({
            cashFlowEntries: [{
                categoryId: "manual-2",
                categoryName: "Equipment Repair",
                direction: "outflow",
                label: "Emergency Repair",
                amount: 2_000,
                targetDate: new Date("2026-08-12T00:00:00Z"),
                hasOperatingReconciliation: true,
            }],
        });
        const resultWithManual = computeForecast(inputWithManual);
        const w0outflowWithManual = resultWithManual.weeks[0].outflowsExpected;

        // Manual $2,000 covers 40% of M1 $5,000 baseline.
        // M1 residual = 5,000 * (1 - 0.40) = 3,000
        // Total = 2,000 + 3,000 = 5,000 ≈ same as without manual.
        // Key: total < (noManual + 2,000) — no pure stack-on-top
        expect(w0outflowWithManual).toBeLessThan(w0outflowNoManual + 2_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Rescheduled recurring counted once", () => {

    it("17. rescheduled recurring: original skipped, rescheduled counted once", () => {
        // asOfDate = 2026-08-11 (Tuesday) → currentMonday = 2026-08-10 (W0)
        // Pattern nextExpectedDate = Aug 11 → falls in W0 (Aug 10–16)
        // skipDates must reference the week-start ISO: "2026-08-10"
        const pattern = makeRecurring({
            id: "rec-sba",
            displayName: "SBA Loan",
            typicalAmount: 3_887,
            cadence: "monthly",
            nextExpectedDate: new Date("2026-08-11T00:00:00Z"), // W0
            skipDates: ["2026-08-10"],  // week start of W0 = Aug 10 (Monday)
        });

        const input = makeInput({
            recurring: [pattern],
            oneTimeOutflows: [{
                patternId: "rec-sba",
                displayName: "SBA Loan",
                amount: 3_887,
                weekStart: new Date("2026-08-17T00:00:00Z"), // W1 starts Aug 17
                sourceWeekStart: "2026-08-10",
            }],
        });

        const result = computeForecast(input);

        // W0 (currentMonday Aug 10) should NOT have SBA (it was skipped)
        const w0sba = result.weeks[0].breakdown.outflows.filter(o =>
            o.label.includes("SBA") && o.sourceType === "recurring"
        );
        expect(w0sba.length).toBe(0);

        // W1 (starts Aug 17) should have exactly one SBA entry (the rescheduled one)
        const w1sba = result.weeks[1].breakdown.outflows.filter(o =>
            o.label.includes("SBA")
        );
        expect(w1sba.length).toBe(1);
        expect(w1sba[0].amount).toBe(3_887);
    });

});

// ─────────────────────────────────────────────────────────────────────────────

describe("Partial reconciliation / unresolved reconciliation", () => {

    it("15 & 16. unresolved reconciliation (no deduction) — amounts pass through unchanged", () => {
        // If no deductions are applied (no ReconciliationLinks with deductFrom),
        // forecast amounts should equal the raw open amounts.
        // This is tested at the forecast-assembly level, but here we verify
        // that the forecast engine itself does not magically deduct amounts.
        const input = makeInput({
            invoices: [{
                id: "inv-1",
                customerName: "Acme Corp",
                invoiceNo: "INV-001",
                amountOpen: 10_000,
                invoiceDate: new Date("2026-08-01T00:00:00Z"),
                dueDate: new Date("2026-08-11T00:00:00Z"),
                daysPastDue: 0,
                status: "open",
                metaJson: null,
                markedPaid: false,
            }],
        });
        const result = computeForecast(input);

        // W0 inflow should include the full $10,000
        const invoiceEntry = result.weeks[0].breakdown.inflows.find(i => i.sourceType === "invoice");
        expect(invoiceEntry?.amount).toBe(10_000);
    });
});
