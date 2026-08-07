import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assembleForecastData } from '../forecast-assembly';
import { computeForecast } from '../forecast';

// Mock dependencies
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

describe('Reconciliation Deduplication Logic', () => {
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

    it('1. manual $25k + matching $25k AR counts once', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "adj_25k", amount: 25000, origin: "user", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_25k", amountOpen: 25000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "adj_25k", targetId: "inv_25k", matchedAmount: 25000 }
        ]);

        const { input } = await assembleForecastData('cid');
        
        // Either adj_25k yields or inv_25k yields based on string compare.
        // String compare: "adj_25k" < "inv_25k". So "inv_25k" > "adj_25k", meaning "inv_25k" yields.
        // yieldingId = "inv_25k".
        // Therefore, inv_25k will have amountOpen = 0 (and be excluded), adj_25k retains 25000.
        expect(input.invoices.length).toBe(0);
        expect(input.cashFlowEntries).toEqual([
            expect.objectContaining({ sourceId: "adj_25k", amount: 25000 })
        ]);
    });

    it('2. manual $89k partially matched to several AR records leaves unmatched remainder', async () => {
        // "manual_89k" > "inv_1", "inv_2", so "manual_89k" will yield.
        mockFindManyAdjustments.mockResolvedValue([
            { id: "manual_89k", amount: 89000, origin: "user", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_1", amountOpen: 20000, dueDate: new Date("2026-08-07") },
            { id: "inv_2", amountOpen: 30000, dueDate: new Date("2026-08-08") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "manual_89k", targetId: "inv_1", matchedAmount: 20000 },
            { status: "active", sourceId: "manual_89k", targetId: "inv_2", matchedAmount: 30000 }
        ]);

        const { input } = await assembleForecastData('cid');
        
        // "manual_89k" > "inv_1" -> manual_89k yields 20k
        // "manual_89k" > "inv_2" -> manual_89k yields 30k
        // Total deduction for manual_89k = 50000
        // Remainder = 39000
        expect(input.invoices).toHaveLength(2);
        expect(input.invoices.find(i => i.id === "inv_1")?.amountOpen).toBe(20000);
        expect(input.invoices.find(i => i.id === "inv_2")?.amountOpen).toBe(30000);
        expect(input.cashFlowEntries).toEqual([
            expect.objectContaining({ sourceId: "manual_89k", amount: 39000 })
        ]);
    });

    it('3. one AR partially matched to multiple manual expectations deducts correctly', async () => {
        // "z_inv" > "manual_1", "manual_2", so "z_inv" will yield.
        mockFindManyAdjustments.mockResolvedValue([
            { id: "manual_1", amount: 10000, origin: "user", effectiveDate: new Date("2026-08-05") },
            { id: "manual_2", amount: 5000, origin: "user", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "z_inv", amountOpen: 20000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "manual_1", targetId: "z_inv", matchedAmount: 10000 },
            { status: "active", sourceId: "manual_2", targetId: "z_inv", matchedAmount: 5000 }
        ]);

        const { input } = await assembleForecastData('cid');
        
        expect(input.cashFlowEntries).toHaveLength(2);
        expect(input.invoices).toHaveLength(1);
        expect(input.invoices[0].amountOpen).toBe(5000); // 20k - 15k
    });

    it('4. matched amount cannot exceed source or target amount - implicitly capped to 0', async () => {
        // "z_manual" yields.
        mockFindManyAdjustments.mockResolvedValue([
            { id: "z_manual", amount: 10000, origin: "user", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv", amountOpen: 20000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "z_manual", targetId: "inv", matchedAmount: 15000 } // link is larger than manual entry
        ]);

        const { input } = await assembleForecastData('cid');
        
        // Remainder should be Math.max(0, 10000 - 15000) = 0. So it's omitted.
        expect(input.cashFlowEntries).toHaveLength(0);
        expect(input.invoices[0].amountOpen).toBe(20000);
    });

    it('5. removing/reversing a link restores original forecast contribution', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "z_manual", amount: 25000, origin: "user", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_25k", amountOpen: 25000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "reversed", sourceId: "z_manual", targetId: "inv_25k", matchedAmount: 25000 }
        ]);

        const { input } = await assembleForecastData('cid');
        
        // Link is not active, both retain full value
        expect(input.invoices[0].amountOpen).toBe(25000);
        expect(input.cashFlowEntries).toEqual([
            expect.objectContaining({ sourceId: "z_manual", amount: 25000 })
        ]);
    });

    it('6. unrelated records continue to count independently', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "z_manual", amount: 10000, origin: "user", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv", amountOpen: 20000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([]); // No links

        const { input } = await assembleForecastData('cid');
        
        expect(input.invoices[0].amountOpen).toBe(20000);
        expect(input.cashFlowEntries).toEqual([
            expect.objectContaining({ sourceId: "z_manual", amount: 10000 })
        ]);
    });
});
