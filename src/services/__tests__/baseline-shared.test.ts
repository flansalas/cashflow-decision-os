import { describe, it, expect } from "vitest";
import { prepareBaselineTransactions } from "../baseline-shared";
import { BankTxForBaseline, RecurringPatternForBaseline } from "../baseline";

describe("Shared Baseline Preprocessing", () => {
    it("should produce identical prepared transactions for the overlapping 26 weeks of M1 and M4", () => {
        const asOfDate = new Date("2024-01-01T00:00:00Z");
        
        const txs: BankTxForBaseline[] = [];
        // Generate daily transactions for a 60-week period (well over 52 weeks)
        for (let i = 0; i < 420; i++) {
            const d = new Date(asOfDate);
            d.setDate(d.getDate() - i);
            txs.push({
                date: d,
                amount: i % 2 === 0 ? 100 : -50,
                merchantKey: "Test Merchant " + i
            });
        }
        
        const patterns: RecurringPatternForBaseline[] = [
            {
                merchantKey: "Test Merchant 10",
                direction: "inflow",
                category: "income",
                isIncluded: true,
                typicalAmount: 100,
                amountStdDev: 0,
                cadence: "weekly"
            }
        ];
        
        // M1 runs for 52 weeks
        const m1Result = prepareBaselineTransactions(txs, patterns, asOfDate, undefined, 52);
        
        // M4 runs for 26 weeks
        const m4Result = prepareBaselineTransactions(txs, patterns, asOfDate, undefined, 26);
        
        // The weekBuckets for M4 (0-25) should identically match the first 26 buckets of M1
        // because both start from mondayBefore(asOfDate, WEEKS_TO_ANALYZE).
        // Wait, prepareBaselineTransactions goes from `mondayBefore(asOfDate, WEEKS_TO_ANALYZE)` FORWARD.
        // So week 0 of M1 is 52 weeks ago. week 0 of M4 is 26 weeks ago.
        // Therefore, the 26 weeks of M4 (indices 0-25) should match M1 (indices 26-51).
        
        expect(m4Result.weekBuckets.length).toBe(26);
        expect(m1Result.weekBuckets.length).toBe(52);
        
        for (let i = 0; i < 26; i++) {
            expect(m4Result.weekBuckets[i]).toEqual(m1Result.weekBuckets[i + 26]);
        }
        
        // Similarly for daily series
        for (let i = 0; i < 26 * 7; i++) {
            expect(m4Result.dailyInflowSeries[i]).toBe(m1Result.dailyInflowSeries[i + (26 * 7)]);
            expect(m4Result.dailyOutflowSeries[i]).toBe(m1Result.dailyOutflowSeries[i + (26 * 7)]);
        }
    });
});
