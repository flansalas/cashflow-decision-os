import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '@/db/prisma';
import { getCanonicalBaselineInputs } from '@/services/baseline-fetch';

vi.mock('@/db/prisma', () => ({
    default: {
        bankTransaction: { findMany: vi.fn() },
        recurringPattern: { findMany: vi.fn() },
    }
}));

describe('M1 Input Preparation (getCanonicalBaselineInputs)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('excludes confirmed internal transfers from M1 (resolved status)', async () => {
        const mockTxs = [
            { amount: 1000, txDate: new Date('2026-07-20'), description: 'Operating Income', direction: 'inflow', internalTransferStatus: null },
            { amount: 500, txDate: new Date('2026-07-21'), description: 'Transfer to Savings', direction: 'outflow', internalTransferStatus: 'resolved' },
            { amount: 500, txDate: new Date('2026-07-22'), description: 'Transfer from Checking', direction: 'inflow', internalTransferStatus: 'resolved' }
        ];

        vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue(mockTxs as any);
        vi.mocked(prisma.recurringPattern.findMany).mockResolvedValue([] as any);

        const { bankTxsForBaseline } = await getCanonicalBaselineInputs('test-company');

        expect(bankTxsForBaseline.length).toBe(3);
        
        const operatingIncome = bankTxsForBaseline[0];
        expect(operatingIncome.amount).toBe(1000); // inflow

        const transferOut = bankTxsForBaseline[1];
        expect(transferOut.amount).toBe(0); // Excluded

        const transferIn = bankTxsForBaseline[2];
        expect(transferIn.amount).toBe(0); // Excluded
    });

    it('unresolved transfers remain treated according to the existing policy (ignored/pending/null treated as normal)', async () => {
        const mockTxs = [
            { amount: 100, txDate: new Date('2026-07-20'), description: 'Unknown transfer', direction: 'inflow', internalTransferStatus: 'ignored' },
            { amount: 200, txDate: new Date('2026-07-21'), description: 'Pending transfer', direction: 'outflow', internalTransferStatus: 'pending' },
            { amount: 300, txDate: new Date('2026-07-22'), description: 'Null transfer', direction: 'inflow', internalTransferStatus: null }
        ];

        vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue(mockTxs as any);
        vi.mocked(prisma.recurringPattern.findMany).mockResolvedValue([] as any);

        const { bankTxsForBaseline } = await getCanonicalBaselineInputs('test-company');

        expect(bankTxsForBaseline[0].amount).toBe(100);
        expect(bankTxsForBaseline[1].amount).toBe(-200);
        expect(bankTxsForBaseline[2].amount).toBe(300);
    });

    it('only fetches active recurring patterns', async () => {
        vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue([] as any);
        vi.mocked(prisma.recurringPattern.findMany).mockResolvedValue([] as any);

        await getCanonicalBaselineInputs('test-company');

        expect(prisma.recurringPattern.findMany).toHaveBeenCalledWith({
            where: { companyId: 'test-company', status: 'active' }
        });
    });

    it('no tenant behavior changes - filters strictly by companyId', async () => {
        vi.mocked(prisma.bankTransaction.findMany).mockResolvedValue([] as any);
        vi.mocked(prisma.recurringPattern.findMany).mockResolvedValue([] as any);

        await getCanonicalBaselineInputs('tenant-a');

        expect(prisma.bankTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { companyId: 'tenant-a' }
        }));
    });
});
