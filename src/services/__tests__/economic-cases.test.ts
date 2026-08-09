import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assembleForecastData } from '../forecast-assembly';
import { computeForecast } from '../forecast';

const mockFindManySnapshot = vi.fn();
const mockFindManyAdjustments = vi.fn();
const mockFindManyInvoices = vi.fn();
const mockFindManyBills = vi.fn();
const mockFindManyProfiles = vi.fn();
const mockFindManyOverrides = vi.fn();
const mockFindManyCategories = vi.fn();
const mockFindManyEntries = vi.fn();
const mockFindManyLinks = vi.fn();
const mockFindManyBank = vi.fn();
const mockFindManyVariance = vi.fn();
const mockFindManyObs = vi.fn();

vi.mock('@/db/prisma', () => ({
    default: {
        cashSnapshot: { findFirst: (...args: any[]) => mockFindManySnapshot(...args) },
        cashAdjustment: { findMany: (...args: any[]) => mockFindManyAdjustments(...args) },
        receivableInvoice: { findMany: (...args: any[]) => mockFindManyInvoices(...args) },
        payableBill: { findMany: (...args: any[]) => mockFindManyBills(...args) },
        customerProfile: { findMany: (...args: any[]) => mockFindManyProfiles(...args) },
        vendorProfile: { findMany: (...args: any[]) => mockFindManyProfiles(...args) },
        assumption: { findFirst: () => null },
        recurringPattern: { findMany: () => [] },
        override: { findMany: (...args: any[]) => mockFindManyOverrides(...args) },
        bankTransaction: { findMany: (...args: any[]) => mockFindManyBank(...args) },
        companyNote: { findMany: () => [] },
        cashFlowCategory: { findMany: (...args: any[]) => mockFindManyCategories(...args) },
        cashFlowEntry: { findMany: (...args: any[]) => mockFindManyEntries(...args) },
        baselineVarianceLedger: { findMany: (...args: any[]) => mockFindManyVariance(...args) },
        customerPaymentObservation: { findMany: (...args: any[]) => mockFindManyObs(...args) },
        reconciliationLink: { findMany: (...args: any[]) => mockFindManyLinks(...args) },
    }
}));

describe('Economic Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFindManySnapshot.mockResolvedValue({ asOfDate: new Date("2026-08-01"), bankBalance: 10000 });
        mockFindManyAdjustments.mockResolvedValue([]);
        mockFindManyInvoices.mockResolvedValue([]);
        mockFindManyBills.mockResolvedValue([]);
        mockFindManyProfiles.mockResolvedValue([]);
        mockFindManyOverrides.mockResolvedValue([]);
        mockFindManyCategories.mockResolvedValue([]);
        mockFindManyEntries.mockResolvedValue([]);
        mockFindManyLinks.mockResolvedValue([]);
        mockFindManyBank.mockResolvedValue([]);
        mockFindManyVariance.mockResolvedValue([]);
        mockFindManyObs.mockResolvedValue([]);
    });

    it('CASE A: Manual inflow $25k + AR $25k, deductFrom="target"', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "adj_25k", amount: 25000, origin: "user", type: "Test", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_25k", amountOpen: 25000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "adj_25k", targetId: "inv_25k", targetType: "invoice", matchedAmount: 25000, deductFrom: "target" }
        ]);

        const { input } = await assembleForecastData('cid');
        input.hasBankBaseline = true;
        input.baselineInflowWeekly = 100000;
        input.assumptions = {
            bufferMin: 10000,
            fixedWeeklyOutflow: 0,
            payrollCadence: "biweekly",
            projectionSafetyMargin: 1.0,
            invoiceTypicalDelayDays: 0,
            billTypicalDelayDays: 0,
            startingCashOffset: 0
        };

        const f = computeForecast(input);
        
        expect(input.invoices.length).toBe(0);
        expect(input.cashFlowEntries).toEqual([expect.objectContaining({ sourceId: "adj_25k", amount: 25000 })]);
        expect(input.cashFlowEntries![0].hasOperatingReconciliation).toBe(true);
        expect(f.weeks[0].inflowsExpected).toBe(100000); 
    });

    it('CASE B: Same records, deductFrom="source"', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "adj_25k", amount: 25000, origin: "user", type: "Test", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_25k", amountOpen: 25000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "adj_25k", targetId: "inv_25k", targetType: "invoice", matchedAmount: 25000, deductFrom: "source" }
        ]);

        const { input } = await assembleForecastData('cid');
        input.hasBankBaseline = true;
        input.baselineInflowWeekly = 100000;
        input.assumptions = {
            bufferMin: 10000,
            fixedWeeklyOutflow: 0,
            payrollCadence: "biweekly",
            projectionSafetyMargin: 1.0,
            invoiceTypicalDelayDays: 0,
            billTypicalDelayDays: 0,
            startingCashOffset: 0
        };
        
        const f = computeForecast(input);
        
        expect(input.cashFlowEntries?.length).toBe(0);
        expect(input.invoices.length).toBe(1);
        expect(input.invoices[0].amountOpen).toBe(25000);
        expect(f.weeks[0].inflowsExpected).toBe(100000);
    });

    it('CASE C: Manual inflow $40k + AR $25k, deductFrom="target"', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "adj_40k", amount: 40000, origin: "user", type: "Test", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_25k", amountOpen: 25000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "adj_40k", targetId: "inv_25k", targetType: "invoice", matchedAmount: 25000, deductFrom: "target" }
        ]);

        const { input } = await assembleForecastData('cid');
        input.hasBankBaseline = true;
        input.baselineInflowWeekly = 100000;
        input.assumptions = {
            bufferMin: 10000,
            fixedWeeklyOutflow: 0,
            payrollCadence: "biweekly",
            projectionSafetyMargin: 1.0,
            invoiceTypicalDelayDays: 0,
            billTypicalDelayDays: 0,
            startingCashOffset: 0
        };
        
        const f = computeForecast(input);
        
        expect(input.cashFlowEntries![0].amount).toBe(40000);
        expect(input.invoices.length).toBe(0);
        expect(f.weeks[0].inflowsExpected).toBe(100000);
    });

    it('CASE D: Manual inflow $40k + AR $25k, deductFrom="source"', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "adj_40k", amount: 40000, origin: "user", type: "Test", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_25k", amountOpen: 25000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "adj_40k", targetId: "inv_25k", targetType: "invoice", matchedAmount: 25000, deductFrom: "source" }
        ]);

        const { input } = await assembleForecastData('cid');
        input.hasBankBaseline = true;
        input.baselineInflowWeekly = 100000;
        input.assumptions = {
            bufferMin: 10000,
            fixedWeeklyOutflow: 0,
            payrollCadence: "biweekly",
            projectionSafetyMargin: 1.0,
            invoiceTypicalDelayDays: 0,
            billTypicalDelayDays: 0,
            startingCashOffset: 0
        };
        
        const f = computeForecast(input);
        
        expect(input.cashFlowEntries![0].amount).toBe(15000);
        expect(input.invoices[0].amountOpen).toBe(25000);
        expect(f.weeks[0].inflowsExpected).toBe(100000);
    });
});
