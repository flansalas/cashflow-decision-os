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
    it("excludes true split payroll debits while retaining unrelated bank fees in a Payroll account", () => {
        const result = prepareBaselineTransactions(
            [
                { amount: -100, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "ADP PAYROLL", accountName: "0070 UB - 3740 (Payroll)" },
                { amount: -185.96, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "ADP TAXES", accountName: "0070 UB - 3740 (Payroll)" },
                { amount: -37, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "Bank Fee", accountName: "0070 UB - 3740 (Payroll)" },
                { amount: -500, date: new Date("2026-08-07T00:00:00.000Z"), merchantKey: "Operating supplier", accountName: "0050 UB - 0446 (Spending)" },
            ],
            [],
            new Date("2026-08-10T00:00:00.000Z"),
            assumptions,
            2,
        );

        // 500 (supplier) + 37 (bank fee) = 537
        expect(result.weekBuckets.reduce((sum, week) => sum + week.outflow, 0)).toBe(537);
    });
});
