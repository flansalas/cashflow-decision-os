import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import prisma from '@/db/prisma';

process.env.OPENAI_API_KEY = 'test-key'; // Set before imports

const createMock = vi.fn().mockResolvedValue({
    choices: [{
        message: {
            content: JSON.stringify({
                inflowFactors: new Array(13).fill(1.0),
                outflowFactors: new Array(13).fill(1.0),
                inflowExplanations: new Array(13).fill("Mock"),
                outflowExplanations: new Array(13).fill("Mock"),
                reasoningLog: "Mock log"
            })
        }
    }]
});

vi.mock('openai', () => {
    return {
        default: class OpenAI {
            chat = {
                completions: {
                    create: createMock
                }
            };
        }
    };
});

describe('AI Baseline', () => {
    let mockFindMany: any;

    beforeEach(() => {
        process.env.OPENAI_API_KEY = 'test-key';
        
        // Mock prisma
        mockFindMany = vi.fn().mockResolvedValue([]);
        vi.spyOn(prisma.company, 'findUnique').mockResolvedValue({ id: 'c1', name: 'Test', isDemo: false, defaultBankAccountName: 'Test' } as any);
        vi.spyOn(prisma.receivableInvoice, 'findMany').mockResolvedValue([]);
        vi.spyOn(prisma.payableBill, 'findMany').mockResolvedValue([]);
        vi.spyOn(prisma.override, 'findMany').mockResolvedValue([]);
        
        // We want to track what variance ledger returns, then verify it gets filtered
        vi.spyOn(prisma.baselineVarianceLedger, 'findMany').mockResolvedValue([
            { id: 'verified-1', companyId: 'c1', weekStart: new Date(), actualInflow: 100, actualOutflow: 50 },
            { id: 'unverified-2', companyId: 'c1', weekStart: new Date(), actualInflow: 1000, actualOutflow: 500 }
        ] as any);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('AI does not consume ineligible variance memory', async () => {
        const { computeAIBaseline } = await import('../ai-baseline');
        const eligibleIds = new Set(['verified-1']);
        
        const result = await computeAIBaseline('c1', 1000, 1000, '{}', 2, 2, eligibleIds);
        
        const promptCall = createMock.mock.calls[0][0].messages[0].content;
        
        // The prompt should contain the verified row's actuals (100, 50)
        expect(promptCall).toContain('Total $100.00');
        expect(promptCall).toContain('Total $50.00');
        
        // The prompt should NOT contain the unverified row's actuals (1000, 500)
        expect(promptCall).not.toContain('Total $1000.00');
        expect(promptCall).not.toContain('Total $500.00');
    });

    it('AI receives empty memory state when all rows are unverified', async () => {
        const { computeAIBaseline } = await import('../ai-baseline');
        createMock.mockClear();
        const result = await computeAIBaseline('c1', 1000, 1000, '{}', 2, 2, new Set());
        
        const promptCall = createMock.mock.calls[0][0].messages[0].content;
        
        expect(promptCall).toContain('No verified historical variance memory available.');
        expect(promptCall).not.toContain('Total $100.00');
        expect(promptCall).not.toContain('Total $1000.00');
    });
});
