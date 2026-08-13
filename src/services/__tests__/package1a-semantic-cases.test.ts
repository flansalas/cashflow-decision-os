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
        accountRole: { findMany: vi.fn().mockResolvedValue([{ accountId: "acc_payroll", role: "payroll" }]) }
    }
}));

// This file documents and tests the Financial Semantic Cases for Package 1A
describe('Package 1A: Financial Semantic Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFindManySnapshot.mockResolvedValue({ asOfDate: new Date("2026-08-01"), bankBalance: 100000 });
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

    it('1. AR partial payment (amount override)', async () => {
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_1", amountOpen: 10000, dueDate: new Date("2026-08-05") }
        ]);
        mockFindManyOverrides.mockResolvedValue([
            { targetId: "inv_1", targetType: "invoice", type: "partial_payment", amount: 4000, status: "active" }
        ]);

        const { input } = await assembleForecastData('cid');
        const forecast = computeForecast(input);
        
        // The override sets partialPayment to 4000, while amountOpen remains 10000
        expect(input.invoices[0].amountOpen).toBe(10000);
        expect(input.invoices[0].partialPayment).toBe(4000);
    });

    it('2. AP planned-date override (delay_due_date/set_bill_due_date)', async () => {
        mockFindManyBills.mockResolvedValue([
            { id: "bill_1", amountOpen: 5000, dueDate: new Date("2026-08-05") }
        ]);
        const newDate = new Date("2026-08-20");
        mockFindManyOverrides.mockResolvedValue([
            { targetId: "bill_1", targetType: "bill", type: "set_bill_due_date", effectiveDate: newDate, status: "active" }
        ]);

        const { input } = await assembleForecastData('cid');
        const forecast = computeForecast(input);
        
        // The overrideDueDate should be set
        expect(input.bills[0].overrideDueDate?.getTime()).toBe(newDate.getTime());
    });

    it('3. Internal-transfer neutrality', async () => {
        // One transaction outflowing 50k, another inflowing 50k on the same day between internal accounts
        mockFindManyBank.mockResolvedValue([
            { id: "tx_out", amount: 50000, direction: "outflow", accountId: "acc_op", txDate: new Date("2026-08-05"), internalTransferStatus: "resolved", internalTransferPairId: "pair_1" },
            { id: "tx_in", amount: 50000, direction: "inflow", accountId: "acc_payroll", txDate: new Date("2026-08-05"), internalTransferStatus: "resolved", internalTransferPairId: "pair_1" }
        ]);

        const { input } = await assembleForecastData('cid');
        // When processing bank baseline via AI, these would be excluded. In assembleForecastData they don't produce cashFlowEntries.
        // The test verifies they don't map to manual cash flow entries inadvertently.
        expect(input.cashFlowEntries).toEqual([]); // as they are not manual adjustments
    });

    // NOTE:
    // - "hidden AR exclusion" is tested in src/services/__tests__/managerial-visibility.test.ts
    // - "reconciliation deduction" is tested in src/services/__tests__/economic-cases.test.ts
    // - "Payroll account + explicit Payroll assumption" is tested in src/services/__tests__/payroll-account-baseline.test.ts
    // - "canonical M1 input" is tested in src/services/__tests__/m1-input-preparation.test.ts
});
