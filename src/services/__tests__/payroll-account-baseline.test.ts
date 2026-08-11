import { describe, expect, it } from "vitest";
import { prepareBaselineTransactions } from "@/services/baseline-shared";

const assumptions = {
    payrollAllInAmount: 54309,
    payrollNextDate: new Date("2026-08-14T00:00:00.000Z"),
    payrollCadence: "weekly",
    rentMonthlyAmount: null,
    rentDayOfMonth: null,
};

describe("Payroll account M1 input exclusion (Deterministic Role-based)", () => {
    it("excludes outflows from an explicitly Payroll-role account when payroll assumption is active", () => {
        const result = prepareBaselineTransactions(
            [
                { amount: -54309, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "PREAUTHORIZED ACH DEBIT", accountRole: "payroll" },
                { amount: -37, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "Bank Fee", accountRole: "payroll" },
            ],
            [],
            new Date("2026-08-10T00:00:00.000Z"),
            assumptions,
            2,
        );

        // Entire Payroll account is the cash envelope, so ALL outflows are excluded
        expect(result.weekBuckets.reduce((sum, week) => sum + week.outflow, 0)).toBe(0);
    });

    it("retains the identical transaction from an Operating-role account", () => {
        const result = prepareBaselineTransactions(
            [
                { amount: -54309, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "PREAUTHORIZED ACH DEBIT", accountRole: "operating" },
                { amount: -37, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "Bank Fee", accountRole: "operating" },
            ],
            [],
            new Date("2026-08-10T00:00:00.000Z"),
            assumptions,
            2,
        );
        expect(result.weekBuckets.reduce((sum, week) => sum + week.outflow, 0)).toBe(54346);
    });

    it("does not exclude anything merely by naming an Operating account 'Payroll Account'", () => {
        const result = prepareBaselineTransactions(
            [
                { amount: -54309, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "PREAUTHORIZED ACH DEBIT", accountName: "Payroll Account", accountRole: "operating" },
            ],
            [],
            new Date("2026-08-10T00:00:00.000Z"),
            assumptions,
            2,
        );
        expect(result.weekBuckets.reduce((sum, week) => sum + week.outflow, 0)).toBe(54309);
    });

    it("does not silently remove Payroll-role account activity without an explicit payroll assumption", () => {
        const result = prepareBaselineTransactions(
            [
                { amount: -54309, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "PREAUTHORIZED ACH DEBIT", accountRole: "payroll" },
            ],
            [],
            new Date("2026-08-10T00:00:00.000Z"),
            undefined,
            2,
        );
        expect(result.weekBuckets.reduce((sum, week) => sum + week.outflow, 0)).toBe(54309);
    });
});
