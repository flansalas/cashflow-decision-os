import { describe, it, expect, vi, beforeEach } from 'vitest';
import { approveExecutionPlan } from '../execution-plan-approval';
import { computeCanonicalHash } from '../canonical-hash';

const CANONICAL_PAYLOAD = '{}';
const VALID_FORECAST_HASH = computeCanonicalHash(CANONICAL_PAYLOAD);

const mocks = vi.hoisted(() => {
    const mockFindCheckpoint = vi.fn();
    const mockFindExecutionPlans = vi.fn();
    const mockCreateExecutionPlan = vi.fn();
    const mockUpdateExecutionPlan = vi.fn();
    const mockCreateActionItems = vi.fn();
    const mockCreateChangeLog = vi.fn();
    const mockFindUniqueCheckpoint = vi.fn();
    const mockFindForecastCertification = vi.fn();

    const mockTransaction = vi.fn(async (cb) => {
        return cb({
            $executeRaw: vi.fn(),
            forecastCheckpoint: { findUnique: mockFindUniqueCheckpoint, findFirst: mockFindCheckpoint },
            forecastVersionCertification: { findFirst: mockFindForecastCertification },
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
        mockUpdateExecutionPlan, mockCreateActionItems, mockCreateChangeLog, mockTransaction,
        mockFindUniqueCheckpoint, mockFindForecastCertification
    };
});

vi.mock('@/db/prisma', () => ({
    default: {
        $transaction: mocks.mockTransaction,
        forecastCheckpoint: { findUnique: mocks.mockFindCheckpoint }
    }
}));

vi.mock('@/services/data-readiness-evaluation', () => ({
    evaluateCompanyDataReadiness: vi.fn().mockResolvedValue({
        status: 'decision_ready',
        evidenceHash: 'readiness-hash'
    })
}));

vi.mock('@/services/forecast-certification', () => ({
    assertCertifiedDecisionIntegrity: vi.fn()
}));

function makeValidCheckpoint(overrides = {}) {
    const baseDate = new Date('2026-08-01T00:00:00Z');
    const weeks = Array.from({ length: 13 }).map((_, i) => ({
        weekStart: new Date(baseDate.getTime() + i * 7 * 24 * 60 * 60 * 1000)
    }));

    return {
        id: 'cp_123',
        companyId: 'co_1',
        sealedAt: new Date(),
        generatedAt: new Date(),
        forecastVersionHash: VALID_FORECAST_HASH,
        canonicalPayloadJson: CANONICAL_PAYLOAD,
        forecastSchemaVersion: 1,
        hashAlgorithm: 'sha256-canonical-json-v1',
        cashSnapshotId: 'cash_1',
        forecastWeeks: weeks,
        ...overrides
    };
}

describe('Package 1C: Approval Binding and Concurrency', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        
        mocks.mockFindCheckpoint.mockResolvedValue(makeValidCheckpoint());

        mocks.mockFindExecutionPlans.mockResolvedValue([]);
        mocks.mockFindForecastCertification.mockResolvedValue({
            id: 'cert_1',
            companyId: 'co_1',
            forecastCheckpointId: 'cp_123',
            forecastVersionHash: VALID_FORECAST_HASH,
            cashSnapshotId: 'cash_1',
            readinessEvidenceHash: 'readiness-hash',
            status: 'certified',
            downsideScenario: {}
        });
        mocks.mockCreateExecutionPlan.mockResolvedValue({ id: 'plan_new', version: 1, weekStart: new Date('2026-08-01T00:00:00Z') });
        mocks.mockUpdateExecutionPlan.mockResolvedValue({ id: 'plan_new', version: 1, weekStart: new Date('2026-08-01T00:00:00Z'), status: 'approved' });
    });

    const defaultReq = {
        companyId: 'co_1',
        weekStart: '2026-08-01T00:00:00Z',
        forecastCheckpointId: 'cp_123',
        actions: []
    };

    describe('Checkpoint Validation', () => {
        it('rejects missing checkpoint', async () => {
            mocks.mockFindCheckpoint.mockResolvedValueOnce(null);
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint not found or belongs to another company');
        });

        it('rejects foreign tenant', async () => {
            mocks.mockFindCheckpoint.mockResolvedValueOnce(makeValidCheckpoint({ companyId: 'foreign_co' }));
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint not found or belongs to another company');
        });

        it('rejects unsealed checkpoint', async () => {
            mocks.mockFindCheckpoint.mockResolvedValueOnce(makeValidCheckpoint({ sealedAt: null }));
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint is not sealed');
        });

        it('rejects missing generatedAt', async () => {
            mocks.mockFindCheckpoint.mockResolvedValueOnce(makeValidCheckpoint({ generatedAt: null }));
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint is missing generatedAt');
        });

        it('rejects missing forecastVersionHash', async () => {
            mocks.mockFindCheckpoint.mockResolvedValueOnce(makeValidCheckpoint({ forecastVersionHash: null }));
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint is missing forecastVersionHash');
        });

        it('rejects missing canonicalPayloadJson', async () => {
            mocks.mockFindCheckpoint.mockResolvedValueOnce(makeValidCheckpoint({ canonicalPayloadJson: null }));
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint is missing canonicalPayloadJson');
        });

        it('rejects missing schema/hash algorithm', async () => {
            mocks.mockFindCheckpoint.mockResolvedValueOnce(makeValidCheckpoint({ forecastSchemaVersion: null }));
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint is missing forecastSchemaVersion');
            
            mocks.mockFindCheckpoint.mockResolvedValueOnce(makeValidCheckpoint({ hashAlgorithm: null }));
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint is missing hashAlgorithm');
        });

        it('rejects if weeks !== 13 (e.g. 12 or 14)', async () => {
            const cp = makeValidCheckpoint();
            cp.forecastWeeks = cp.forecastWeeks.slice(0, 12);
            mocks.mockFindCheckpoint.mockResolvedValueOnce(cp);
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint has 12 weeks instead of exactly 13');

            const cp14 = makeValidCheckpoint();
            cp14.forecastWeeks.push({ weekStart: new Date(cp14.forecastWeeks[12].weekStart.getTime() + 7 * 24 * 60 * 60 * 1000) });
            mocks.mockFindCheckpoint.mockResolvedValueOnce(cp14);
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint has 14 weeks instead of exactly 13');
        });

        it('rejects wrong W1', async () => {
            const cp = makeValidCheckpoint();
            // shift the first week
            cp.forecastWeeks[0].weekStart = new Date('2026-08-08T00:00:00Z');
            mocks.mockFindCheckpoint.mockResolvedValueOnce(cp);
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('First week of checkpoint does not match the requested plan weekStart');
        });

        it('rejects non-contiguous weeks', async () => {
            const cp = makeValidCheckpoint();
            // skip a week in the middle
            cp.forecastWeeks[2].weekStart = new Date(cp.forecastWeeks[2].weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
            mocks.mockFindCheckpoint.mockResolvedValueOnce(cp);
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint weeks are not strictly contiguous by 7 days');
        });

        it('rejects foreign tenant due to tenant-scoped query', async () => {
            // The query `where: { id, companyId }` will return null if it's a foreign tenant
            mocks.mockFindCheckpoint.mockResolvedValueOnce(null);
            await expect(approveExecutionPlan(defaultReq)).rejects.toThrow('Checkpoint not found or belongs to another company');
        });

        it('valid 13-week checkpoint succeeds', async () => {
            // Setup is already valid
            await expect(approveExecutionPlan(defaultReq)).resolves.toBeDefined();
        });
    });

    describe('Transaction Flow & Lineage', () => {
        it('supersedes existing approved plan exactly once using the new draft ID', async () => {
            mocks.mockFindExecutionPlans.mockResolvedValueOnce([
                { id: 'p1', version: 1, status: 'approved', forecastCheckpointId: 'cp_old' }
            ]);
            mocks.mockCreateExecutionPlan.mockResolvedValueOnce({ id: 'draft_2' });
            mocks.mockFindUniqueCheckpoint.mockResolvedValueOnce({ forecastVersionHash: 'hash_old' });

            await approveExecutionPlan({ ...defaultReq, expectedCurrentPlanId: 'p1', revisionReason: 'found error' });

            // Ensure the initial status update uses the draft id directly, no PENDING_NEW_ID.
            expect(mocks.mockUpdateExecutionPlan).toHaveBeenCalledWith({
                where: { id: 'p1' },
                data: expect.objectContaining({
                    status: 'superseded',
                    supersededByPlanId: 'draft_2'
                })
            });

            // Ensure changelog captured before and after hashes
            expect(mocks.mockCreateChangeLog).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: 'REVISED',
                    forecastVersionHashBefore: 'hash_old',
                    forecastVersionHashAfter: VALID_FORECAST_HASH
                })
            });
        });
        
        it('creates proper changelog for initial approval', async () => {
            await approveExecutionPlan(defaultReq);

            expect(mocks.mockCreateChangeLog).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: 'APPROVED',
                    forecastVersionHashBefore: null,
                    forecastVersionHashAfter: VALID_FORECAST_HASH
                })
            });
        });
    });
});
