import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assembleForecastData } from '../forecast-assembly';
import { computeForecast } from '../forecast';
import prisma from '@/db/prisma';

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
        cashAdjustment: { 
            findMany: (...args: any[]) => mockFindManyAdjustments(...args),
            findUnique: vi.fn()
        },
        receivableInvoice: { 
            findMany: (...args: any[]) => mockFindManyInvoices(...args),
            findUnique: vi.fn()
        },
        payableBill: { findMany: (...args: any[]) => mockFindManyBills(...args), findUnique: vi.fn() },
        customerProfile: { findMany: (...args: any[]) => mockFindManyProfiles(...args) },
        vendorProfile: { findMany: (...args: any[]) => mockFindManyProfiles(...args) },
        assumption: { findFirst: () => null },
        recurringPattern: { findMany: () => [] },
        override: { findMany: (...args: any[]) => mockFindManyOverrides(...args) },
        bankTransaction: { findMany: (...args: any[]) => mockFindManyBank(...args) },
        companyNote: { findMany: () => [] },
        cashFlowCategory: { findMany: (...args: any[]) => mockFindManyCategories(...args) },
        cashFlowEntry: { findMany: (...args: any[]) => mockFindManyEntries(...args), findUnique: vi.fn() },
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

    it('1. explicit deductFrom="target" makes target yield, source retains amount', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "adj_25k", amount: 25000, origin: "user", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_25k", amountOpen: 25000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "adj_25k", targetId: "inv_25k", matchedAmount: 25000, deductFrom: "target" }
        ]);

        const { input } = await assembleForecastData('cid');
        
        // deductFrom: target -> inv_25k yields, amountOpen = 0 (omitted)
        expect(input.invoices.length).toBe(0);
        expect(input.cashFlowEntries).toEqual([
            expect.objectContaining({ sourceId: "adj_25k", amount: 25000 })
        ]);
    });

    it('2. explicit deductFrom="source" makes source yield, target retains amount', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "adj_25k", amount: 25000, origin: "user", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_25k", amountOpen: 25000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "adj_25k", targetId: "inv_25k", matchedAmount: 25000, deductFrom: "source" }
        ]);

        const { input } = await assembleForecastData('cid');
        
        // deductFrom: source -> adj_25k yields, amount = 0 (omitted)
        expect(input.cashFlowEntries?.length).toBe(0);
        expect(input.invoices).toEqual([
            expect.objectContaining({ id: "inv_25k", amountOpen: 25000 })
        ]);
    });

    it('3. unresolved link (null deductFrom) does not affect forecast', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "adj_25k", amount: 25000, origin: "user", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_25k", amountOpen: 25000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "adj_25k", targetId: "inv_25k", matchedAmount: 25000, deductFrom: null }
        ]);

        const { input } = await assembleForecastData('cid');
        
        expect(input.cashFlowEntries).toEqual([
            expect.objectContaining({ sourceId: "adj_25k", amount: 25000 })
        ]);
        expect(input.invoices).toEqual([
            expect.objectContaining({ id: "inv_25k", amountOpen: 25000 })
        ]);
    });

    it('4. manual $89k partially matched (yielding) leaves unmatched remainder', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "manual_89k", amount: 89000, origin: "user", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_1", amountOpen: 20000, dueDate: new Date("2026-08-07") },
            { id: "inv_2", amountOpen: 30000, dueDate: new Date("2026-08-08") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "active", sourceId: "manual_89k", targetId: "inv_1", matchedAmount: 20000, deductFrom: "source" },
            { status: "active", sourceId: "manual_89k", targetId: "inv_2", matchedAmount: 30000, deductFrom: "source" }
        ]);

        const { input } = await assembleForecastData('cid');
        
        expect(input.invoices).toHaveLength(2);
        expect(input.cashFlowEntries).toEqual([
            expect.objectContaining({ sourceId: "manual_89k", amount: 39000 })
        ]);
    });

    it('5. removing/reversing a link restores original forecast contribution', async () => {
        mockFindManyAdjustments.mockResolvedValue([
            { id: "z_manual", amount: 25000, origin: "user", effectiveDate: new Date("2026-08-05") }
        ]);
        mockFindManyInvoices.mockResolvedValue([
            { id: "inv_25k", amountOpen: 25000, dueDate: new Date("2026-08-07") }
        ]);
        mockFindManyLinks.mockResolvedValue([
            { status: "reversed", sourceId: "z_manual", targetId: "inv_25k", matchedAmount: 25000, deductFrom: "source" }
        ]);

        const { input } = await assembleForecastData('cid');
        
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

import { validateReconciliationLink } from '../reconciliation';

describe('Reconciliation Validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects allocation exceeding source available', async () => {
        vi.spyOn(prisma.cashAdjustment, 'findUnique').mockResolvedValue({ id: "src", companyId: "cid", amount: 10000 } as any);
        vi.spyOn(prisma.receivableInvoice, 'findUnique').mockResolvedValue({ id: "tgt", companyId: "cid", amountOpen: 20000 } as any);
        
        // mock existing link of 5k
        mockFindManyLinks.mockResolvedValue([
            { matchedAmount: 5000, status: "active", sourceId: "src", targetId: "other" }
        ]);

        await expect(validateReconciliationLink("cid", "cash_adjustment", "src", "receivable_invoice", "tgt", 6000))
            .rejects.toThrow(/exceeds source available/);
    });

    it('rejects allocation exceeding target available', async () => {
        vi.spyOn(prisma.cashAdjustment, 'findUnique').mockResolvedValue({ id: "src", companyId: "cid", amount: 20000 } as any);
        vi.spyOn(prisma.receivableInvoice, 'findUnique').mockResolvedValue({ id: "tgt", companyId: "cid", amountOpen: 10000 } as any);
        
        // mock existing link of 5k
        mockFindManyLinks.mockResolvedValue([
            { matchedAmount: 5000, status: "active", sourceId: "other", targetId: "tgt" }
        ]);

        await expect(validateReconciliationLink("cid", "cash_adjustment", "src", "receivable_invoice", "tgt", 6000))
            .rejects.toThrow(/exceeds target available/);
    });

    it('allows valid partial allocations', async () => {
        vi.spyOn(prisma.cashAdjustment, 'findUnique').mockResolvedValue({ id: "src", companyId: "cid", amount: 10000 } as any);
        vi.spyOn(prisma.receivableInvoice, 'findUnique').mockResolvedValue({ id: "tgt", companyId: "cid", amountOpen: 10000 } as any);
        
        mockFindManyLinks.mockResolvedValue([]);

        await expect(validateReconciliationLink("cid", "cash_adjustment", "src", "receivable_invoice", "tgt", 5000))
            .resolves.not.toThrow();
    });
});
