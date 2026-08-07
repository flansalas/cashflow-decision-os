import { describe, it, expect } from 'vitest';
import { computeForecast, ForecastInput, addDays } from '../forecast';

describe('Forecast Assembly Logic', () => {
    const defaultDate = new Date('2026-08-01T00:00:00.000Z');

    const defaultInput: ForecastInput = {
        adjustedOpeningCash: 100000,
        bankBalance: 100000,
        adjustmentsTotal: 0,
        asOfDate: defaultDate,
        invoices: [],
        bills: [],
        recurring: [],
        assumptions: {
            bufferMin: 10000,
            fixedWeeklyOutflow: 0,
            payrollCadence: 'biweekly',
            payrollAllInAmount: null,
            payrollNextDate: null,
            rentMonthlyAmount: null,
            rentDayOfMonth: null,
            paymentCurveJson: '{"current":0,"1-14":1,"15-30":2,"31-60":3,"61+":4}',
            highRiskAgingDays: 61,
            projectionSafetyMargin: 1.0,
        },
        hasBankBaseline: true,
        baselineConfidenceTier: 'high',
        variableOutflowWeekly: 50000,
        variableOutflowBand: 0.1,
        baselineInflowWeekly: 60000,
        baselineInflowBand: 0.1,
        baselineInflowCadence: 1,
        baselineOutflowCadence: 1,
        cashMarginRatio: 1,
        cogsLagWeeks: 0,
        isARHeavy: false,
        oneTimeOutflows: [],
        cashFlowEntries: [],
    };

    it('1. residual baseline + explicit AP reconciles exactly', () => {
        // Given a baseline outflow of 50000, and explicit AP of 20000 in week 1
        const input = {
            ...defaultInput,
            bills: [
                {
                    id: 'b1',
                    companyId: 'c1',
                    vendorName: 'Vendor',
                    billNo: '1',
                    amountOpen: 20000,
                    status: 'open',
                    dueDate: defaultDate, // lands in week 1
                    expenseClass: 'cogs',
                    createdAt: defaultDate,
                    updatedAt: defaultDate
                } as any
            ]
        };

        const result = computeForecast(input);
        const w0 = result.weeks[0];

        // Explicit AP is 20000, Baseline Residual is 30000 (50k - 20k)
        expect(w0.outflowsExpected).toBe(50000);

        const apItem = w0.breakdown.outflows.find(o => o.section === 'AP Bills');
        const baselineItem = w0.breakdown.outflows.find(o => o.section === 'Baseline Outflow');

        expect(apItem?.amount).toBe(20000);
        expect(baselineItem?.amount).toBe(30000);
        
        // Sum of breakdown must match total
        const sum = w0.breakdown.outflows.reduce((acc, curr) => acc + curr.amount, 0);
        expect(sum).toBe(w0.outflowsExpected);
    });

    it('2. recurring and payroll are not counted twice', () => {
        // Payroll in assumptions AND a recurring pattern
        const input = {
            ...defaultInput,
            assumptions: {
                ...defaultInput.assumptions,
                payrollAllInAmount: 15000,
                payrollNextDate: defaultDate, // lands in week 1
            },
            recurring: [
                {
                    id: 'r1',
                    displayName: 'Some Recurring',
                    direction: 'outflow',
                    typicalAmount: 5000, // another recurring
                    nextExpectedDate: defaultDate,
                    cadence: 'monthly',
                    isIncluded: true,
                    status: 'active',
                    confidence: 'high'
                } as any
            ]
        };

        const result = computeForecast(input);
        const w0 = result.weeks[0];

        const payrolls = w0.breakdown.outflows.filter(o => o.label.toLowerCase().includes('payroll'));
        const recurring = w0.breakdown.outflows.filter(o => o.section === 'Recurring Commitments');
        
        // One synthetic payroll, one standard recurring
        expect(payrolls.length).toBe(1);
        expect(payrolls[0].amount).toBe(15000);
        expect(recurring.length).toBe(2); // The pattern + the synthetic payroll both end up here

        // Neither of these should reduce the variable baseline because they are fixed!
        const baselineItem = w0.breakdown.outflows.find(o => o.section === 'Baseline Outflow');
        expect(baselineItem?.amount).toBe(50000); // unaffected by payroll/recurring

        expect(w0.outflowsExpected).toBe(50000 + 15000 + 5000);
    });

    it('3. rescheduled items that are past-due do not appear in Week 1', () => {
        const input = {
            ...defaultInput,
            oneTimeOutflows: [
                {
                    patternId: 'p1',
                    displayName: 'Stale Outflow',
                    amount: 90000,
                    weekStart: new Date('2025-01-01T00:00:00.000Z'), // Past due!
                },
                {
                    patternId: 'p2',
                    displayName: 'Valid Outflow',
                    amount: 10000,
                    weekStart: addDays(defaultDate, 7), // Next week (Week 2)
                }
            ]
        };

        const result = computeForecast(input);
        const w0 = result.weeks[0];
        const w1 = result.weeks[1];

        const w0Rescheduled = w0.breakdown.outflows.filter(o => o.type === 'rescheduled');
        expect(w0Rescheduled.length).toBe(0); // Stale should not appear!

        const w1Rescheduled = w1.breakdown.outflows.filter(o => o.type === 'rescheduled');
        expect(w1Rescheduled.length).toBe(1); // Valid appears
        expect(w1Rescheduled[0].amount).toBe(10000);
    });

    it('4. explicit AR replaces covered residual correctly', () => {
        const input = {
            ...defaultInput,
            invoices: [
                {
                    id: 'i1',
                    companyId: 'c1',
                    customerName: 'Cust',
                    invoiceNo: '1',
                    amountOpen: 15000,
                    status: 'open',
                    dueDate: defaultDate,
                    createdAt: defaultDate,
                    updatedAt: defaultDate
                } as any
            ]
        };

        const result = computeForecast(input);
        const w0 = result.weeks[0];

        // Total inflow expected = 60000
        expect(w0.inflowsExpected).toBe(60000);
        
        const arItem = w0.breakdown.inflows.find(i => i.section === 'AR Receipts');
        const baselineItem = w0.breakdown.inflows.find(i => i.section === 'Baseline Inflow');

        expect(arItem?.amount).toBe(15000);
        expect(baselineItem?.amount).toBe(45000); // 60k - 15k
    });

    it('5. every forecast week reconciles to its component ledger', () => {
        const input = {
            ...defaultInput,
            bills: [
                { id: 'b1', amountOpen: 10000, status: 'open', dueDate: defaultDate } as any,
                { id: 'b2', amountOpen: 20000, status: 'open', dueDate: addDays(defaultDate, 14) } as any
            ],
            invoices: [
                { id: 'i1', amountOpen: 30000, status: 'open', dueDate: addDays(defaultDate, 7) } as any
            ]
        };

        const result = computeForecast(input);
        
        for (const week of result.weeks) {
            const sumIn = week.breakdown.inflows.reduce((sum, item) => sum + item.amount, 0);
            const sumOut = week.breakdown.outflows.reduce((sum, item) => sum + item.amount, 0);
            
            // Check precision to 2 decimals
            expect(Math.abs(sumIn - week.inflowsExpected)).toBeLessThan(0.01);
            expect(Math.abs(sumOut - week.outflowsExpected)).toBeLessThan(0.01);
        }
    });

    it('6. Cascio regression case: avoids AI error label', () => {
        const input = {
            ...defaultInput,
            aiInflowExplanations: ['AI Error: OPENAI_API_KEY is not set'],
            aiOutflowExplanations: ['AI Error: timeout'],
        };
        const result = computeForecast(input);
        const w0 = result.weeks[0];
        
        const inItem = w0.breakdown.inflows.find(i => i.section === 'Baseline Inflow');
        const outItem = w0.breakdown.outflows.find(o => o.section === 'Baseline Outflow');
        
        expect(inItem?.label).not.toContain('AI Error');
        expect(outItem?.label).not.toContain('AI Error');
    });

    it('7. synthetic second company follows same global logic', () => {
        const input = {
            ...defaultInput,
            variableOutflowWeekly: 100000,
            baselineInflowWeekly: 120000,
            bills: [{ id: 'b1', amountOpen: 80000, status: 'open', dueDate: defaultDate } as any],
        };
        const result = computeForecast(input);
        const w0 = result.weeks[0];
        
        expect(w0.outflowsExpected).toBeCloseTo(100000);
        expect(w0.breakdown.outflows.find(o => o.section === 'AP Bills')?.amount).toBeCloseTo(80000);
        expect(w0.breakdown.outflows.find(o => o.section === 'Baseline Outflow')?.amount).toBeCloseTo(20000);
    });
});
