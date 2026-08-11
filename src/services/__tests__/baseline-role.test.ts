import { describe, it, expect } from 'vitest';
import { prepareBaselineTransactions } from '../baseline-shared';
import { computeBaseline, BankTxForBaseline, RecurringPatternForBaseline, BaselineAssumptions } from '../baseline';

describe('BankAccount Role-based Baseline Treatment (prepareBaselineTransactions)', () => {
    const asOfDate = new Date('2024-01-29'); // Monday
    const patterns: RecurringPatternForBaseline[] = [];
    const weeksToAnalyze = 1;

    it('outflow from explicitly designated Payroll-role account + active explicit payroll assumption -> excluded', () => {
        const txs: BankTxForBaseline[] = [{
            amount: -1000,
            date: new Date('2024-01-24'), // Wednesday
            merchantKey: 'PAYROLL DISTRIBUTION',
            accountRole: 'payroll',
            accountName: 'Operating Account'
        }];
        const assumptions: BaselineAssumptions = { payrollAllInAmount: 5000, payrollCadence: 'biweekly', rentMonthlyAmount: null, rentDayOfMonth: null, payrollNextDate: null };
        const result = prepareBaselineTransactions(txs, patterns, asOfDate, assumptions, weeksToAnalyze);
        expect(result.weekBuckets[0].outflow).toBe(0);
    });

    it('same outflow from Operating-role account with neutral merchant -> remains in M1', () => {
        const txs: BankTxForBaseline[] = [{
            amount: -1000,
            date: new Date('2024-01-24'),
            merchantKey: 'VENDOR PAYMENT',   // neutral merchant — not categorized as payroll
            accountRole: 'operating',
            accountName: 'Payroll Account'   // account name alone must not infer exclusion
        }];
        const assumptions: BaselineAssumptions = { payrollAllInAmount: 5000, payrollCadence: 'biweekly', rentMonthlyAmount: null, rentDayOfMonth: null, payrollNextDate: null };
        const result = prepareBaselineTransactions(txs, patterns, asOfDate, assumptions, weeksToAnalyze);
        expect(result.weekBuckets[0].outflow).toBe(1000);
    });

    it('merely naming an Operating account "Payroll" -> does not change its economic treatment', () => {
        const txs: BankTxForBaseline[] = [{
            amount: -1000,
            date: new Date('2024-01-24'),
            merchantKey: 'VENDOR PAYMENT',   // neutral merchant
            accountRole: 'operating',
            accountName: 'Payroll'            // name-only — must not exclude
        }];
        const assumptions: BaselineAssumptions = { payrollAllInAmount: 5000, payrollCadence: 'biweekly', rentMonthlyAmount: null, rentDayOfMonth: null, payrollNextDate: null };
        const result = prepareBaselineTransactions(txs, patterns, asOfDate, assumptions, weeksToAnalyze);
        expect(result.weekBuckets[0].outflow).toBe(1000);
    });

    it('Payroll-role account without an active explicit payroll assumption -> its outflows are not silently removed', () => {
        const txs: BankTxForBaseline[] = [{
            amount: -1000,
            date: new Date('2024-01-24'),
            merchantKey: 'PAYROLL DISTRIBUTION',
            accountRole: 'payroll',
            accountName: 'Payroll Account'
        }];
        const assumptions: BaselineAssumptions = { payrollAllInAmount: null, payrollCadence: 'biweekly', rentMonthlyAmount: null, rentDayOfMonth: null, payrollNextDate: null };
        const result = prepareBaselineTransactions(txs, patterns, asOfDate, assumptions, weeksToAnalyze);
        expect(result.weekBuckets[0].outflow).toBe(1000);
    });
});

// Regression: low-history fallback in computeBaseline() must respect payroll-role exclusion.
// These tests use fewer than MIN_WEEKS_REQUIRED (12) active weeks so the span-based fallback fires.
describe('computeBaseline() low-history fallback respects Payroll-role exclusion', () => {
    // All transactions within a single week so activeWeeks.length = 1 < 12
    const asOfDate = new Date('2024-01-29');
    const patterns: RecurringPatternForBaseline[] = [];
    const assumptions: BaselineAssumptions = {
        payrollAllInAmount: 5000,
        payrollCadence: 'biweekly',
        rentMonthlyAmount: null,
        rentDayOfMonth: null,
        payrollNextDate: null,
    };

    it('Payroll-role + explicit payroll assumption -> payroll outflow absent from fallback residual M1', () => {
        const txs: BankTxForBaseline[] = [
            // Normal inflow
            { amount: 10000, date: new Date('2024-01-24'), merchantKey: 'CLIENT PAYMENT', accountRole: 'operating' },
            // Payroll outflow from payroll-role account — must be excluded
            { amount: -5000, date: new Date('2024-01-25'), merchantKey: 'PAYROLL DISTRIBUTION', accountRole: 'payroll' },
        ];

        const result = computeBaseline(txs, patterns, asOfDate, assumptions);
        // Payroll-role exclusion must be honoured in the fallback path too.
        expect(result.variableOutflowWeekly).toBe(0);
        expect(result.variableInflowWeekly).toBeGreaterThan(0);
    });

    it('Operating-role with neutral merchant -> outflow remains in fallback residual M1', () => {
        const txs: BankTxForBaseline[] = [
            { amount: 10000, date: new Date('2024-01-24'), merchantKey: 'CLIENT PAYMENT', accountRole: 'operating' },
            // Neutral merchant, operating-role — must NOT be excluded
            { amount: -5000, date: new Date('2024-01-25'), merchantKey: 'VENDOR PAYMENT', accountRole: 'operating' },
        ];

        const result = computeBaseline(txs, patterns, asOfDate, assumptions);
        expect(result.variableOutflowWeekly).toBeGreaterThan(0);
    });

    it('Payroll-role without explicit payroll assumption -> outflow remains in fallback residual M1', () => {
        const noPayrollAssumptions: BaselineAssumptions = {
            payrollAllInAmount: null,
            payrollCadence: 'biweekly',
            rentMonthlyAmount: null,
            rentDayOfMonth: null,
            payrollNextDate: null,
        };
        const txs: BankTxForBaseline[] = [
            { amount: 10000, date: new Date('2024-01-24'), merchantKey: 'CLIENT PAYMENT', accountRole: 'operating' },
            // Payroll-role but no assumption active — must NOT be silently excluded
            { amount: -5000, date: new Date('2024-01-25'), merchantKey: 'PAYROLL DISTRIBUTION', accountRole: 'payroll' },
        ];

        const result = computeBaseline(txs, patterns, asOfDate, noPayrollAssumptions);
        expect(result.variableOutflowWeekly).toBeGreaterThan(0);
    });
});
