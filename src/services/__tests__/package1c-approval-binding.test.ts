import { describe, it, expect, vi, beforeEach } from 'vitest';
import { approveExecutionPlan, ApprovalConflictError, ApprovalValidationError } from '../execution-plan-approval';

const mocks = vi.hoisted(() => {
    const mockFindCheckpoint = vi.fn();
    const mockFindExecutionPlans = vi.fn();
    const mockCreateExecutionPlan = vi.fn();
    const mockUpdateExecutionPlan = vi.fn();
    const mockCreateActionItems = vi.fn();
    const mockCreateChangeLog = vi.fn();

    const mockTransaction = vi.fn(async (cb) => {
        return cb({
            $executeRaw: vi.fn(),
            forecastCheckpoint: { findFirst: mockFindCheckpoint },
            executionPlan: {
                findMany: mockFindExecutionPlans,
                create: mockCreateExecutionPlan,
                update: mockUpdateExecutionPlan,
            },
            actionItem: { createMany: mockCreateActionItems },
            changeLog: { create: mockCreateChangeLog }
        });
    });

    return {
        mockFindCheckpoint, mockFindExecutionPlans, mockCreateExecutionPlan,
        mockUpdateExecutionPlan, mockCreateActionItems, mockCreateChangeLog, mockTransaction
    };
});

vi.mock('@/db/prisma', () => ({
    default: {
        $transaction: mocks.mockTransaction,
        forecastCheckpoint: { findFirst: mocks.mockFindCheckpoint }
    }
}));

describe('Package 1C: Approval Binding and Concurrency', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        
        mocks.mockFindCheckpoint.mockResolvedValue({
            id: 'cp_123',
            companyId: 'co_1',
            sealedAt: new Date(),
            forecastVersionHash: 'hash123'
        });

        mocks.mockFindExecutionPlans.mockResolvedValue([]);
        mocks.mockCreateExecutionPlan.mockResolvedValue({ id: 'plan_new', version: 1, weekStart: new Date('2026-08-01') });
        mocks.mockUpdateExecutionPlan.mockResolvedValue({ id: 'plan_new', version: 1, weekStart: new Date('2026-08-01'), status: 'approved' });
    });

    const defaultReq = {
        companyId: 'co_1',
        weekStart: '2026-08-01',
        forecastCheckpointId: 'cp_123',
        actions: []
    };

    it('requires a sealed checkpoint', async () => {
        mocks.mockFindCheckpoint.mockResolvedValueOnce(null);
        await expect(approveExecutionPlan(defaultReq)).rejects.toThrowError(ApprovalValidationError);
    });

    it('rejects approval if an executed week exists', async () => {
        mocks.mockFindExecutionPlans.mockResolvedValue([
            { id: 'p1', version: 1, status: 'executed' }
        ]);
        await expect(approveExecutionPlan(defaultReq)).rejects.toThrowError(ApprovalConflictError);
        await expect(approveExecutionPlan(defaultReq)).rejects.toThrowError(/already executed/);
    });

    it('calculates version as MAX(existing versions) + 1', async () => {
        mocks.mockFindExecutionPlans.mockResolvedValueOnce([
            { id: 'p1', version: 1, status: 'superseded' },
            { id: 'p2', version: 4, status: 'superseded' }, // max
            { id: 'p3', version: 2, status: 'approved' }
        ]);

        await approveExecutionPlan({ ...defaultReq, expectedCurrentPlanId: 'p3', revisionReason: 'rev' });

        expect(mocks.mockCreateExecutionPlan).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ version: 5, status: 'draft' })
        }));
    });

    it('requires expectedCurrentPlanId if an approved plan exists (stale state protection)', async () => {
        mocks.mockFindExecutionPlans.mockResolvedValueOnce([
            { id: 'p1', version: 1, status: 'approved' }
        ]);
        await expect(approveExecutionPlan(defaultReq)).rejects.toThrowError(ApprovalConflictError);
    });

    it('uses transient draft state during construction before finalizing to approved', async () => {
        mocks.mockCreateExecutionPlan.mockResolvedValueOnce({ id: 'draft_1' });
        await approveExecutionPlan(defaultReq);

        expect(mocks.mockCreateExecutionPlan).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'draft' })
        }));

        expect(mocks.mockUpdateExecutionPlan).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'draft_1' },
            data: expect.objectContaining({ status: 'approved' })
        }));
    });

    it('supersedes existing approved plan during revision', async () => {
        mocks.mockFindExecutionPlans.mockResolvedValueOnce([
            { id: 'p1', version: 1, status: 'approved' }
        ]);
        mocks.mockCreateExecutionPlan.mockResolvedValueOnce({ id: 'draft_2' });

        await approveExecutionPlan({ ...defaultReq, expectedCurrentPlanId: 'p1', revisionReason: 'found error' });

        // Update the old plan to superseded
        expect(mocks.mockUpdateExecutionPlan).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'p1' },
            data: expect.objectContaining({ status: 'superseded' })
        }));
    });
});
