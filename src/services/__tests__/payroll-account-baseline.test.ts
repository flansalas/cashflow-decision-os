import { describe, expect, it } from "vitest";
import { prepareBaselineTransactions } from "@/services/baseline-shared";

const assumptions = {
    payrollAllInAmount: 54309,
    payrollNextDate: new Date("2026-08-14T00:00:00.000Z"),
    payrollCadence: "weekly",
    rentMonthlyAmount: null,
    rentDayOfMonth: null,
};

describe("Payroll account M1 input exclusion", () => {
    it("excludes split payroll debits already represented by explicit payroll", () => {
        const result = prepareBaselineTransactions(
            [
                { amount: -100, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "PREAUTHORIZED ACH DEBIT", accountName: "0070 UB - 3740 (Payroll)" },
                { amount: -185.96, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "PREAUTHORIZED ACH DEBIT", accountName: "0070 UB - 3740 (Payroll)" },
                { amount: -500, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "Operating supplier", accountName: "0050 UB - 0446 (Spending)" },
            ],
            [],
            new Date("2026-08-10T00:00:00.000Z"),
            assumptions,
            2,
        );

        expect(result.weekBuckets.reduce((sum, week) => sum + week.outflow, 0)).toBe(500);
    });

    it("does not infer payroll from a generic ACH description on another account", () => {
        const result = prepareBaselineTransactions(
            [{ amount: -100, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "PREAUTHORIZED ACH DEBIT", accountName: "0050 UB - 0446 (Spending)" }],
            [],
            new Date("2026-08-10T00:00:00.000Z"),
            assumptions,
            2,
        );

        expect(result.weekBuckets.reduce((sum, week) => sum + week.outflow, 0)).toBe(100);
    });
});
