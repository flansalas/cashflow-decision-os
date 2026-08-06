import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Use vi.hoisted() so mock factories can reference these before initialization
// ---------------------------------------------------------------------------
const { mockPrisma, mockComputeBaseline } = vi.hoisted(() => {
    const mockPrisma = {
        bankTransaction: { findMany: vi.fn() },
        recurringPattern: { findMany: vi.fn() },
        cashSnapshot: { findFirst: vi.fn() },
        assumption: { findFirst: vi.fn() },
        receivableInvoice: { findMany: vi.fn() },
        payableBill: { findMany: vi.fn() },
        baselineSnapshot: {
            findUnique: vi.fn(),
            update: vi.fn(),
            upsert: vi.fn(),
        },
        changeLog: { create: vi.fn() },
    };
    const mockComputeBaseline = vi.fn();
    return { mockPrisma, mockComputeBaseline };
});

vi.mock('@/db/prisma', () => ({
    default: mockPrisma,
}));

// computeBaseline mock – we control hasSufficientHistory per test
vi.mock('@/services/baseline', () => ({
    computeBaseline: (...args: unknown[]) => mockComputeBaseline(...args),
}));

// computeAIBaseline mock – always returns null so we skip AI logic
vi.mock('@/services/ai-baseline', () => ({
    computeAIBaseline: vi.fn().mockResolvedValue(null),
}));

// ---------------------------------------------------------------------------
// Import SUT after mocks are registered
// ---------------------------------------------------------------------------
import { buildAndCacheBaseline } from '@/services/baseline-snapshot';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal baseline object returned by computeBaseline. */
function makeBaseline(hasSufficientHistory: boolean) {
    return {
        hasSufficientHistory,
        baselineConfidenceTier: hasSufficientHistory ? 'good' : 'insufficient',
        variableInflowWeekly: 1000,
        variableOutflowWeekly: 800,
        variableInflowBand: 200,
        variableOutflowBand: 150,
        conservativeInflowWeekly: 900,
        conservativeOutflowWeekly: 700,
        weeklyBuckets: [],
        inflowCadence: 1,
        outflowCadence: 1,
    };
}

/** Minimal existing snapshot stored in the DB. */
function makeExistingSnapshot(hasSufficientHistory: boolean) {
    return {
        hasSufficientHistory,
        baselineConfidenceTier: hasSufficientHistory ? 'good' : 'insufficient',
        companyId: 'company-123',
    };
}

/** Reset all prisma mocks to safe defaults before each test. */
function resetPrismaMocks() {
    mockPrisma.bankTransaction.findMany.mockResolvedValue([]);
    mockPrisma.recurringPattern.findMany.mockResolvedValue([]);
    mockPrisma.cashSnapshot.findFirst.mockResolvedValue(null);
    mockPrisma.assumption.findFirst.mockResolvedValue(null);
    mockPrisma.receivableInvoice.findMany.mockResolvedValue([]);
    mockPrisma.payableBill.findMany.mockResolvedValue([]);
    mockPrisma.baselineSnapshot.findUnique.mockResolvedValue(null);
    mockPrisma.baselineSnapshot.update.mockResolvedValue({});
    mockPrisma.baselineSnapshot.upsert.mockResolvedValue({});
    mockPrisma.changeLog.create.mockResolvedValue({});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('baseline-snapshot data loss guard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetPrismaMocks();
    });

    it('guard does not fire when new company has hasSufficientHistory=false (no prior snapshot)', async () => {
        // No existing snapshot in the DB
        mockPrisma.baselineSnapshot.findUnique.mockResolvedValue(null);
        // New baseline is insufficient (fresh company with no history)
        mockComputeBaseline.mockReturnValue(makeBaseline(false));

        await buildAndCacheBaseline('company-123');

        // Guard condition: !false && null?.hasSufficientHistory → guard does NOT fire
        expect(mockPrisma.changeLog.create).not.toHaveBeenCalled();
        expect(mockPrisma.baselineSnapshot.update).not.toHaveBeenCalled();

        // Normal upsert path executes
        expect(mockPrisma.baselineSnapshot.upsert).toHaveBeenCalledTimes(1);
    });

    it('guard does not fire when both snapshots have sufficient history', async () => {
        // Existing snapshot with sufficient history
        mockPrisma.baselineSnapshot.findUnique.mockResolvedValue(
            makeExistingSnapshot(true),
        );
        // New baseline also has sufficient history
        mockComputeBaseline.mockReturnValue(makeBaseline(true));

        await buildAndCacheBaseline('company-123');

        // Guard condition: !true && true → false → guard does NOT fire
        expect(mockPrisma.changeLog.create).not.toHaveBeenCalled();
        expect(mockPrisma.baselineSnapshot.update).not.toHaveBeenCalled();

        // Normal upsert path executes
        expect(mockPrisma.baselineSnapshot.upsert).toHaveBeenCalledTimes(1);
    });

    it('guard fires when history drops from true to false - marks degraded and returns early', async () => {
        // Existing snapshot had sufficient history
        mockPrisma.baselineSnapshot.findUnique.mockResolvedValue(
            makeExistingSnapshot(true),
        );
        // New baseline has LOST sufficient history
        mockComputeBaseline.mockReturnValue(makeBaseline(false));

        await buildAndCacheBaseline('company-123');

        // Guard condition: !false && true → true → guard FIRES
        expect(mockPrisma.changeLog.create).toHaveBeenCalledTimes(1);
        expect(mockPrisma.changeLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    companyId: 'company-123',
                    action: 'baseline_data_loss_detected',
                }),
            }),
        );

        expect(mockPrisma.baselineSnapshot.update).toHaveBeenCalledTimes(1);
        expect(mockPrisma.baselineSnapshot.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { companyId: 'company-123' },
                data: expect.objectContaining({
                    baselineConfidenceTier: 'degraded_data_loss',
                }),
            }),
        );

        // Early return means upsert is NOT called
        expect(mockPrisma.baselineSnapshot.upsert).not.toHaveBeenCalled();
    });

    it('guard allows normal update when history stays false→false', async () => {
        // Existing snapshot was already insufficient
        mockPrisma.baselineSnapshot.findUnique.mockResolvedValue(
            makeExistingSnapshot(false),
        );
        // New baseline is also insufficient
        mockComputeBaseline.mockReturnValue(makeBaseline(false));

        await buildAndCacheBaseline('company-123');

        // Guard condition: !false && false → false → guard does NOT fire
        expect(mockPrisma.changeLog.create).not.toHaveBeenCalled();
        expect(mockPrisma.baselineSnapshot.update).not.toHaveBeenCalled();

        // Normal upsert path executes
        expect(mockPrisma.baselineSnapshot.upsert).toHaveBeenCalledTimes(1);
    });

    it('guard allows normal update when history is new true→true (no prior snapshot, new is true)', async () => {
        // No existing snapshot
        mockPrisma.baselineSnapshot.findUnique.mockResolvedValue(null);
        // New baseline has sufficient history
        mockComputeBaseline.mockReturnValue(makeBaseline(true));

        await buildAndCacheBaseline('company-123');

        // Guard condition: !true && undefined → false → guard does NOT fire
        expect(mockPrisma.changeLog.create).not.toHaveBeenCalled();
        expect(mockPrisma.baselineSnapshot.update).not.toHaveBeenCalled();

        // Normal upsert path executes
        expect(mockPrisma.baselineSnapshot.upsert).toHaveBeenCalledTimes(1);
    });
});
