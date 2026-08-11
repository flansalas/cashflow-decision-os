import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareBaselineTransactions, mondayBefore } from '../baseline-shared';
import { BankTxForBaseline, RecurringPatternForBaseline, BaselineAssumptions } from '../baseline';

describe('Baseline Date Bucketing & Timezone Invariance', () => {
    // 52 weeks ago from 2026-07-27 (which is a Monday)
    // 2026-07-27 is a Monday. 52 weeks ago is 2025-07-28.
    const anchorDate = new Date('2026-07-27T00:00:00.000Z');
    
    // We'll test with a 2-week window to keep the fixture small but verify boundaries
    const weeksToAnalyze = 2;
    // Week 0: 2026-07-13 to 2026-07-19
    // Week 1: 2026-07-20 to 2026-07-26
    const asOfDate = new Date('2026-07-27T00:00:00.000Z');

    const generateFixture = () => {
        const txs: BankTxForBaseline[] = [
            // Exact week boundaries
            // Week 0 starts 2026-07-13T00:00:00.000Z
            { date: new Date('2026-07-13T00:00:00.000Z'), amount: 100, merchantKey: 'w0_monday' }, // Included in Week 0
            { date: new Date('2026-07-19T00:00:00.000Z'), amount: 100, merchantKey: 'w0_sunday' }, // Included in Week 0
            
            // Week 1 starts 2026-07-20T00:00:00.000Z
            { date: new Date('2026-07-20T00:00:00.000Z'), amount: 100, merchantKey: 'w1_monday' }, // Included in Week 1
            { date: new Date('2026-07-26T00:00:00.000Z'), amount: 100, merchantKey: 'w1_sunday' }, // Included in Week 1
            
            // Outside bounds
            { date: new Date('2026-07-12T00:00:00.000Z'), amount: 100, merchantKey: 'out_sunday_before' }, // Excluded (before W0)
            { date: new Date('2026-07-27T00:00:00.000Z'), amount: 100, merchantKey: 'out_monday_after' }, // Excluded (after W1)
            
            // Mid-week with time components
            { date: new Date('2026-07-20T12:00:00.000Z'), amount: 100, merchantKey: 'w1_monday_noon' }, // Included in Week 1
            { date: new Date('2026-07-26T23:59:59.999Z'), amount: 100, merchantKey: 'w1_sunday_end' }, // Included in Week 1
        ];

        return txs;
    };

    const runWithTimezone = (tz: string, txs: BankTxForBaseline[]) => {
        const originalTZ = process.env.TZ;
        process.env.TZ = tz;
        
        const result = prepareBaselineTransactions(txs, [], asOfDate, undefined, weeksToAnalyze);
        
        // Restore TZ
        if (originalTZ) process.env.TZ = originalTZ;
        else delete process.env.TZ;
        
        return result;
    };

    it('processes exact Monday and Sunday boundaries correctly under UTC', () => {
        const txs = generateFixture();
        const result = runWithTimezone('UTC', txs);
        
        expect(result.weekBuckets.length).toBe(2);
        
        // Week 0: 2 transactions (w0_monday, w0_sunday)
        expect(result.weekBuckets[0].inflow).toBe(200);
        
        // Week 1: 4 transactions (w1_monday, w1_sunday, w1_monday_noon, w1_sunday_end)
        expect(result.weekBuckets[1].inflow).toBe(400);
    });

    it('processes exact Monday and Sunday boundaries identically under America/New_York', () => {
        const txs = generateFixture();
        const result = runWithTimezone('America/New_York', txs);
        
        expect(result.weekBuckets.length).toBe(2);
        
        // Week 0: 2 transactions (w0_monday, w0_sunday)
        expect(result.weekBuckets[0].inflow).toBe(200);
        
        // Week 1: 4 transactions (w1_monday, w1_sunday, w1_monday_noon, w1_sunday_end)
        expect(result.weekBuckets[1].inflow).toBe(400);
    });

    it('produces identical bucket boundaries and totals regardless of machine timezone', () => {
        const txs = generateFixture();
        const resultUTC = runWithTimezone('UTC', txs);
        const resultNY = runWithTimezone('America/New_York', txs);
        
        expect(resultUTC.weekBuckets).toEqual(resultNY.weekBuckets);
        expect(resultUTC.dailyInflowSeries).toEqual(resultNY.dailyInflowSeries);
    });

    it('maintains existing exclusions (recurring patterns)', () => {
        const txs = generateFixture();
        // Add a recurring pattern match that should be excluded
        const patterns: RecurringPatternForBaseline[] = [
            {
                merchantKey: 'w0_monday',
                displayName: 'W0 Monday',
                direction: 'inflow',
                category: 'operating',
                typicalAmount: 100,
                amountStdDev: 0,
                cadence: 'weekly',
                isIncluded: true
            }
        ];
        
        const result = prepareBaselineTransactions(txs, patterns, asOfDate, undefined, weeksToAnalyze);
        
        // Week 0 inflow should now be 100 because w0_monday (100) is excluded
        expect(result.weekBuckets[0].inflow).toBe(100);
    });

    it('mondayBefore calculates the correct UTC date regardless of timezone', () => {
        const d = new Date('2026-07-27T00:00:00.000Z');
        
        const originalTZ = process.env.TZ;
        
        process.env.TZ = 'UTC';
        const mbUTC = mondayBefore(d, 52);
        
        process.env.TZ = 'America/New_York';
        const mbNY = mondayBefore(d, 52);
        
        if (originalTZ) process.env.TZ = originalTZ;
        else delete process.env.TZ;
        
        expect(mbUTC.toISOString()).toBe('2025-07-28T00:00:00.000Z');
        expect(mbNY.toISOString()).toBe('2025-07-28T00:00:00.000Z');
        expect(mbUTC.getTime()).toBe(mbNY.getTime());
    });
});
