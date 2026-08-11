import { describe, it, expect } from 'vitest';
import { prepareBaselineTransactions } from '../baseline-shared';
import { BankTxForBaseline, RecurringPatternForBaseline, BaselineAssumptions } from '../baseline';

describe('BankAccount Role-based Baseline Treatment', () => {
    const asOfDate = new Date('2024-01-29'); // Monday
    const patterns: RecurringPatternForBaseline[] = [];
    const weeksToAnalyze = 1;

    it('outflow from explicitly designated Payroll-role account + active explicit payroll assumption -> excluded', () => {
        const txs: BankTxForBaseline[] = [{
            amount: -1000,
            date: new Date('2024-01-24'), // Wednesday
            merchantKey: 'ADP',
            accountRole: 'payroll',
            accountName: 'Operating Account'
        }];
        const assumptions: BaselineAssumptions = { payrollAllInAmount: 5000, payrollCadence: 'biweekly', rentMonthlyAmount: null, rentDayOfMonth: null, payrollNextDate: null };
        const result = prepareBaselineTransactions(txs, patterns, asOfDate, assumptions, weeksToAnalyze);
        expect(result.weekBuckets[0].outflow).toBe(0);
    });

    it('same outflow from Operating-role account -> remains in M1', () => {
        const txs: BankTxForBaseline[] = [{
            amount: -1000,
            date: new Date('2024-01-24'),
            merchantKey: 'ADP',
            accountRole: 'operating',
            accountName: 'Payroll Account'
        }];
        const assumptions: BaselineAssumptions = { payrollAllInAmount: 5000, payrollCadence: 'biweekly', rentMonthlyAmount: null, rentDayOfMonth: null, payrollNextDate: null };
        const result = prepareBaselineTransactions(txs, patterns, asOfDate, assumptions, weeksToAnalyze);
        expect(result.weekBuckets[0].outflow).toBe(1000);
    });

    it('merely naming an Operating account "Payroll" -> does not change its economic treatment', () => {
        const txs: BankTxForBaseline[] = [{
            amount: -1000,
            date: new Date('2024-01-24'),
            merchantKey: 'ADP',
            accountRole: 'operating',
            accountName: 'Payroll'
        }];
        const assumptions: BaselineAssumptions = { payrollAllInAmount: 5000, payrollCadence: 'biweekly', rentMonthlyAmount: null, rentDayOfMonth: null, payrollNextDate: null };
        const result = prepareBaselineTransactions(txs, patterns, asOfDate, assumptions, weeksToAnalyze);
        expect(result.weekBuckets[0].outflow).toBe(1000);
    });

    it('Payroll-role account without an active explicit payroll assumption -> its outflows are not silently removed', () => {
        const txs: BankTxForBaseline[] = [{
            amount: -1000,
            date: new Date('2024-01-24'),
            merchantKey: 'ADP',
            accountRole: 'payroll',
            accountName: 'Payroll Account'
        }];
        // No explicit payrollAllInAmount assumption
        const assumptions: BaselineAssumptions = { payrollAllInAmount: null, payrollCadence: 'biweekly', rentMonthlyAmount: null, rentDayOfMonth: null, payrollNextDate: null };
        const result = prepareBaselineTransactions(txs, patterns, asOfDate, assumptions, weeksToAnalyze);
        expect(result.weekBuckets[0].outflow).toBe(1000);
    });
});
