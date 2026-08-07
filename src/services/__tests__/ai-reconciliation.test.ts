import { describe, it, expect, vi, beforeEach } from 'vitest';
import { proposeReconciliations } from '../ai-reconciliation';
import prisma from '@/db/prisma';

// Mock validateReconciliationLink to just return normally unless over-allocated
vi.mock('../reconciliation', () => ({
    validateReconciliationLink: vi.fn().mockResolvedValue(true),
    getAvailableAmount: vi.fn().mockResolvedValue(25000)
}));

const { mockOpenAI } = vi.hoisted(() => {
    return {
        mockOpenAI: {
            chat: {
                completions: {
                    create: vi.fn()
                }
            }
        }
    };
});

vi.mock('openai', () => {
    return {
        default: class {
            chat = mockOpenAI.chat;
        }
    };
});

vi.mock('@/db/prisma', () => ({
    default: {
        cashFlowEntry: {
            findMany: vi.fn(),
            findUnique: vi.fn().mockResolvedValue({ id: 'entry-1', amount: 25000 })
        },
        receivableInvoice: {
            findMany: vi.fn(),
            findUnique: vi.fn()
        },
        payableBill: {
            findMany: vi.fn(),
            findUnique: vi.fn()
        },
        reconciliationLink: {
            findMany: vi.fn().mockResolvedValue([]),
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn()
        }
    }
}));

describe('AI Reconciliation Proposer Policy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('exact amount alone cannot auto-match (downgrades to pending if identity is weak)', async () => {
        vi.mocked(prisma.cashFlowEntry.findMany).mockResolvedValue([{
            id: 'entry-1',
            companyId: 'company-1',
            label: 'Unknown Payment',
            amount: 25000,
            targetDate: new Date('2026-08-10'),
            category: { direction: 'inflow' }
        }] as any);

        vi.mocked(prisma.receivableInvoice.findMany).mockResolvedValue([{
            id: 'inv-1',
            companyId: 'company-1',
            customerName: 'Different Customer',
            amountOpen: 25000,
            status: 'active',
            expectedDate: new Date('2026-08-10')
        }] as any);

        // AI says high confidence, BUT hasStrongIdentityMatch is false
        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        matchFound: true,
                        targetId: 'inv-1',
                        confidence: 'high',
                        reasoning: 'Same amount',
                        hasStrongIdentityMatch: false,
                        preferredTiming: 'source'
                    })
                }
            }]
        });

        await proposeReconciliations('company-1');

        expect(prisma.reconciliationLink.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                confidence: 'medium', // Downgraded!
                deductFrom: null // Pending!
            })
        }));
    });

    it('strong amount + identity + timing + no competitor can auto-match', async () => {
        vi.mocked(prisma.cashFlowEntry.findMany).mockResolvedValue([{
            id: 'entry-1',
            companyId: 'company-1',
            label: 'Acme Corp',
            amount: 25000,
            targetDate: new Date('2026-08-10'),
            category: { direction: 'inflow' }
        }] as any);

        vi.mocked(prisma.receivableInvoice.findMany).mockResolvedValue([{
            id: 'inv-1',
            companyId: 'company-1',
            customerName: 'Acme Corp',
            amountOpen: 25000,
            status: 'active',
            expectedDate: new Date('2026-08-10')
        }] as any);

        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        matchFound: true,
                        targetId: 'inv-1',
                        confidence: 'high',
                        reasoning: 'Perfect match',
                        hasStrongIdentityMatch: true,
                        preferredTiming: 'source'
                    })
                }
            }]
        });

        await proposeReconciliations('company-1');

        expect(prisma.reconciliationLink.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                confidence: 'high',
                deductFrom: 'target' // Auto-activated!
            })
        }));
    });

    it('conflicting timing downgrades the proposal', async () => {
        vi.mocked(prisma.cashFlowEntry.findMany).mockResolvedValue([{
            id: 'entry-1',
            companyId: 'company-1',
            label: 'Acme Corp',
            amount: 25000,
            targetDate: new Date('2026-10-10'), // 2 months away
            category: { direction: 'inflow' }
        }] as any);

        vi.mocked(prisma.receivableInvoice.findMany).mockResolvedValue([{
            id: 'inv-1',
            companyId: 'company-1',
            customerName: 'Acme Corp',
            amountOpen: 25000,
            status: 'active',
            expectedDate: new Date('2026-08-10')
        }] as any);

        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        matchFound: true,
                        targetId: 'inv-1',
                        confidence: 'high', // AI might think it's high
                        reasoning: 'Same entity and amount',
                        hasStrongIdentityMatch: true,
                        preferredTiming: 'source'
                    })
                }
            }]
        });

        // The deterministic candidate filter in ai-reconciliation will actually exclude it entirely 
        // because timing is > 45 days. Let's make it 30 days away to pass the deterministic filter 
        // but fail the 14-day auto-match rule.
        vi.mocked(prisma.cashFlowEntry.findMany).mockResolvedValue([{
            id: 'entry-1',
            companyId: 'company-1',
            label: 'Acme Corp',
            amount: 25000,
            targetDate: new Date('2026-09-05'), // 26 days away
            category: { direction: 'inflow' }
        }] as any);

        await proposeReconciliations('company-1');

        expect(prisma.reconciliationLink.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                confidence: 'medium', // Downgraded due to timing > 14 days
                deductFrom: null
            })
        }));
    });

    it('low-confidence proposals do not bother the user', async () => {
        vi.mocked(prisma.cashFlowEntry.findMany).mockResolvedValue([{
            id: 'entry-1',
            companyId: 'company-1',
            label: 'Acme Corp',
            amount: 25000,
            targetDate: new Date('2026-08-10'),
            category: { direction: 'inflow' }
        }] as any);

        vi.mocked(prisma.receivableInvoice.findMany).mockResolvedValue([{
            id: 'inv-1',
            companyId: 'company-1',
            customerName: 'Acme Corp',
            amountOpen: 25000,
            status: 'active',
            expectedDate: new Date('2026-08-10')
        }] as any);

        mockOpenAI.chat.completions.create.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({
                        matchFound: true,
                        targetId: 'inv-1',
                        confidence: 'low',
                        reasoning: 'Not sure',
                        hasStrongIdentityMatch: false,
                        preferredTiming: 'source'
                    })
                }
            }]
        });

        await proposeReconciliations('company-1');

        expect(prisma.reconciliationLink.create).not.toHaveBeenCalled(); // Ignored entirely
    });
});
