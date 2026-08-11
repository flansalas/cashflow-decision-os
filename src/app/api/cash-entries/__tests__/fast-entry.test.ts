import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as fastEntryPost } from '../fast/route';
import { POST as confirmMatchPost } from '../confirm-match/route';
import prisma from '@/db/prisma';
import { NextRequest } from 'next/server';

vi.mock('@/db/prisma', () => ({
    default: {
        cashSnapshot: {
            findFirst: vi.fn().mockResolvedValue({ asOfDate: '2026-08-01T00:00:00.000Z' })
        },
        cashFlowCategory: {
            findFirst: vi.fn().mockResolvedValue({ id: 'cat-1', direction: 'inflow' }),
            create: vi.fn()
        },
        cashFlowEntry: {
            create: vi.fn().mockImplementation(async (args) => args.data)
        },
        receivableInvoice: {
            findFirst: vi.fn()
        },
        payableBill: {
            findFirst: vi.fn()
        },
        reconciliationLink: {
            create: vi.fn().mockImplementation(async (args) => args.data),
            findUnique: vi.fn(),
            update: vi.fn().mockImplementation(async (args) => args.data)
        },
        override: {
            findMany: vi.fn().mockResolvedValue([])
        }
    }
}));

vi.mock('@clerk/nextjs/server', () => ({
    auth: vi.fn().mockResolvedValue({ userId: 'user-1' })
}));

vi.mock('@/lib/tenant', () => ({
    resolveTenant: vi.fn().mockResolvedValue('company-1')
}));

function mockRequest(body: any) {
    return {
        json: async () => body
    } as unknown as NextRequest;
}

describe('Fast Entry API & Match Confirmation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('creates an entry without a match if no invoice exists', async () => {
        vi.mocked(prisma.receivableInvoice.findFirst).mockResolvedValueOnce(null);

        const req = mockRequest({
            amount: 25000,
            weekNumber: 2,
            label: 'Big Client Payment',
            direction: 'inflow'
        });

        const res = await fastEntryPost(req);
        const data = await res.json();

        expect(data.entry).toBeDefined();
        expect(data.pendingMatch).toBeNull();
        expect(prisma.cashFlowEntry.create).toHaveBeenCalled();
        expect(prisma.reconciliationLink.create).not.toHaveBeenCalled();
    });

    it('identifies a pending match and creates an unactivated reconciliation link', async () => {
        vi.mocked(prisma.receivableInvoice.findFirst).mockResolvedValueOnce({
            id: 'inv-123',
            companyId: 'company-1',
            customerName: 'ACME Corp',
            amount: 25000,
            status: 'active',
            expectedDate: new Date('2026-08-10')
        } as any);

        const req = mockRequest({
            amount: 25000,
            weekNumber: 1,
            label: 'ACME Payment',
            direction: 'inflow'
        });

        const res = await fastEntryPost(req);
        const data = await res.json();

        expect(data.entry).toBeDefined();
        expect(data.pendingMatch).toBeDefined();
        expect(data.pendingMatch.type).toBe('receivable_invoice');
        
        // Assert the link is created but deductFrom is null (so it does not alter forecast yet)
        expect(prisma.reconciliationLink.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                sourceType: 'cash_flow_entry',
                targetType: 'receivable_invoice',
                deductFrom: null
            })
        }));
    });

    it('confirms match using manual (source) timing', async () => {
        vi.mocked(prisma.reconciliationLink.findUnique).mockResolvedValueOnce({
            id: 'link-123',
            companyId: 'company-1'
        } as any);

        const req = mockRequest({
            linkId: 'link-123',
            useTimingFrom: 'source'
        });

        const res = await confirmMatchPost(req);
        const data = await res.json();

        // If manual timing is used, deductFrom should be 'target' so the target yields
        expect(prisma.reconciliationLink.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'link-123' },
            data: { deductFrom: 'target' }
        }));
        expect(data.link.deductFrom).toBe('target');
    });

    it('confirms match using accounting (target) timing', async () => {
        vi.mocked(prisma.reconciliationLink.findUnique).mockResolvedValueOnce({
            id: 'link-123',
            companyId: 'company-1'
        } as any);

        const req = mockRequest({
            linkId: 'link-123',
            useTimingFrom: 'target'
        });

        const res = await confirmMatchPost(req);
        const data = await res.json();

        // If accounting timing is used, deductFrom should be 'source' so the source yields
        expect(prisma.reconciliationLink.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'link-123' },
            data: { deductFrom: 'source' }
        }));
        expect(data.link.deductFrom).toBe('source');
    });
});
