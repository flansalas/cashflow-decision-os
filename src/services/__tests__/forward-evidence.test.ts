import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseResidualForecastSeries, ResidualForecastSeries } from '../evaluation-types';
import { evaluateMaturedCheckpoints } from '../canonical-evaluator';
import prisma from '@/db/prisma';
import * as bankCoverage from '../bank-coverage';
import * as attribution from '../attribution';
import {
    canonicalJsonSerialize,
    computeCanonicalHash,
    FORECAST_SCHEMA_VERSION,
    HASH_ALGORITHM
} from '../canonical-hash';

// Mock dependencies
vi.mock('@/db/prisma', () => ({
    default: {
        forecastCheckpoint: {
            findMany: vi.fn(),
        },
        bankTransaction: {
            findMany: vi.fn(),
        },
        forecastEvaluationObservation: {
            findFirst: vi.fn(),
            update: vi.fn(),
            create: vi.fn(),
        },
        $transaction: vi.fn((cb) => cb(prisma)),
    }
}));

vi.mock('../bank-coverage', () => ({
    verifyBankCoverage: vi.fn(),
}));

vi.mock('../attribution', () => ({
    calculateResidualActuals: vi.fn(),
}));

describe('Forward Evidence Collection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('1 & 2. Serialization Round-trips (M1 Stage 2 & 3)', () => {
        it('should round-trip valid JSON objects correctly', () => {
            const validData: ResidualForecastSeries = {
                inflow: new Array(13).fill(100),
                outflow: new Array(13).fill(200)
            };
            const jsonStr = JSON.stringify(validData);
            
            const parsed = parseResidualForecastSeries(jsonStr);
            expect(parsed).toEqual(validData);
            expect(parsed?.inflow.length).toBe(13);
            expect(parsed?.outflow.length).toBe(13);
        });
    });

    describe('3. M4 Stage 2 Preservation', () => {
        // M4 Stage 2 preservation is validated statically and in integration, 
        // but here we prove that the type system handles it identically.
        it('should require 13 inflow and 13 outflow values', () => {
            const shortData = {
                inflow: new Array(12).fill(100),
                outflow: new Array(13).fill(200)
            };
            const parsed = parseResidualForecastSeries(JSON.stringify(shortData));
            expect(parsed).toBeNull();
        });
    });

    describe('Canonical Evaluator', () => {
        const createMockCheckpoint = (
            baselineOverrides: Record<string, unknown> = {},
            checkpointOverrides: Record<string, unknown> = {}
        ) => {
            const checkpointId = 'cp-1';
            const companyId = 'company-1';
            const firstWeekStart = checkpointOverrides.weekStart instanceof Date
                ? checkpointOverrides.weekStart
                : new Date('2024-01-01T00:00:00Z');
            const forecastWeeks = Array.from({ length: 13 }, (_, index) => {
                const weekStart = new Date(firstWeekStart.getTime() + index * 7 * 86_400_000);
                const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000);
                return { weekNumber: index + 1, weekStart, weekEnd };
            });
            const canonicalPayloadJson = canonicalJsonSerialize({
                schemaVersion: FORECAST_SCHEMA_VERSION,
                companyId,
                weeks: forecastWeeks.map((week) => ({
                    weekNumber: week.weekNumber,
                    weekStart: week.weekStart.toISOString(),
                    weekEnd: week.weekEnd.toISOString()
                }))
            });
            const forecastVersionHash = computeCanonicalHash(canonicalPayloadJson);

            return {
                id: checkpointId,
                companyId,
                weekStart: forecastWeeks[0].weekStart,
                weekEnd: forecastWeeks[0].weekEnd,
                sealedAt: new Date('2024-01-01T12:00:00Z'),
                forecastVersionHash,
                canonicalPayloadJson,
                forecastSchemaVersion: FORECAST_SCHEMA_VERSION,
                hashAlgorithm: HASH_ALGORITHM,
                forecastWeeks: forecastWeeks.map((week) => ({
                    companyId,
                    forecastCheckpointId: checkpointId,
                    forecastVersionHash,
                    weekStart: week.weekStart,
                    weekEnd: week.weekEnd
                })),
                BaselineSnapshotHistory: {
                    m1PreAiResidualJson: JSON.stringify({ inflow: new Array(13).fill(10), outflow: new Array(13).fill(20) }),
                    m1PostAiResidualJson: JSON.stringify({ inflow: new Array(13).fill(15), outflow: new Array(13).fill(25) }),
                    m4PreAiResidualJson: JSON.stringify({ inflow: new Array(13).fill(12), outflow: new Array(13).fill(22) }),
                    ...baselineOverrides
                },
                ...checkpointOverrides
            };
        };

        it('4 & 5. Matured verified horizon creates 6 observations with identical canonical actuals', async () => {
            vi.mocked(prisma.forecastCheckpoint.findMany).mockResolvedValue([createMockCheckpoint({})] as any);
            vi.mocked(bankCoverage.verifyBankCoverage).mockResolvedValue({ isVerified: true } as any);
            vi.mocked(attribution.calculateResidualActuals).mockReturnValue({ residualInflow: 100, residualOutflow: 200 } as any);
            vi.mocked(prisma.forecastEvaluationObservation.findFirst).mockResolvedValue(null);

            const result = await evaluateMaturedCheckpoints('company-1');

            // 13 horizons * 6 observations per horizon = 78 calls
            expect(prisma.forecastEvaluationObservation.create).toHaveBeenCalledTimes(78);
            expect(result).toEqual({ checkpointsExamined: 1, horizonsEvaluated: 13, observationsWritten: 78 });
            
            // Look at horizon 1 specifically
            const calls = vi.mocked(prisma.forecastEvaluationObservation.create).mock.calls;
            const h1Calls = calls.slice(0, 6);

            // M1 Stage 2
            expect(h1Calls[0][0].data).toMatchObject({
                maturedWeekStart: new Date('2024-01-01T00:00:00Z'),
                horizonWeeks: 1,
                direction: 'inflow',
                model: 'm1',
                stage: 'stage2',
                predictionAmount: 10,
                canonicalActual: 100,
                attributionAmbiguity: 'not_assessed',
                evaluationValidity: 'valid'
            });
            expect(h1Calls[1][0].data).toMatchObject({ direction: 'outflow', model: 'm1', stage: 'stage2', predictionAmount: 20, canonicalActual: 200, evaluationValidity: 'valid' });
            // M4 Stage 2
            expect(h1Calls[2][0].data).toMatchObject({ direction: 'inflow', model: 'm4', stage: 'stage2', predictionAmount: 12, canonicalActual: 100, evaluationValidity: 'valid' });
            expect(h1Calls[3][0].data).toMatchObject({ direction: 'outflow', model: 'm4', stage: 'stage2', predictionAmount: 22, canonicalActual: 200, evaluationValidity: 'valid' });
            // M1 Stage 3
            expect(h1Calls[4][0].data).toMatchObject({ direction: 'inflow', model: 'm1', stage: 'stage3', predictionAmount: 15, canonicalActual: 100, evaluationValidity: 'valid' });
            expect(h1Calls[5][0].data).toMatchObject({ direction: 'outflow', model: 'm1', stage: 'stage3', predictionAmount: 25, canonicalActual: 200, evaluationValidity: 'valid' });

            expect(prisma.forecastCheckpoint.findMany).toHaveBeenCalledWith({
                where: {
                    companyId: 'company-1',
                    sealedAt: { not: null },
                    forecastVersionHash: { not: null },
                    canonicalPayloadJson: { not: null },
                    forecastSchemaVersion: FORECAST_SCHEMA_VERSION,
                    hashAlgorithm: HASH_ALGORITHM,
                    weekStart: { lt: expect.any(Date) }
                },
                include: {
                    BaselineSnapshotHistory: true,
                    forecastWeeks: { orderBy: { weekStart: 'asc' } }
                }
            });
        });

        it('6. Unverified but complete week creates inconclusive observations', async () => {
            vi.mocked(prisma.forecastCheckpoint.findMany).mockResolvedValue([createMockCheckpoint({})] as any);
            vi.mocked(bankCoverage.verifyBankCoverage).mockResolvedValue({ isVerified: false } as any);
            vi.mocked(attribution.calculateResidualActuals).mockReturnValue({ residualInflow: 100, residualOutflow: 200 } as any);

            await evaluateMaturedCheckpoints('company-1');

            const calls = vi.mocked(prisma.forecastEvaluationObservation.create).mock.calls;
            expect(calls.length).toBeGreaterThan(0);
            expect(calls[0][0].data.evaluationValidity).toBe('inconclusive');
            expect(calls[0][0].data.accountCompleteness).toBe('unverified');
        });

        it('maps canonical Week 1 through Week 13 to prediction indexes 0 through 12', async () => {
            const predictions = Array.from({ length: 13 }, (_, index) => 101 + index);
            vi.mocked(prisma.forecastCheckpoint.findMany).mockResolvedValue([
                createMockCheckpoint({
                    m1PreAiResidualJson: JSON.stringify({ inflow: predictions, outflow: predictions })
                })
            ] as any);
            vi.mocked(bankCoverage.verifyBankCoverage).mockResolvedValue({ isVerified: true } as any);
            vi.mocked(attribution.calculateResidualActuals).mockReturnValue({ residualInflow: 0, residualOutflow: 0 } as any);
            vi.mocked(prisma.forecastEvaluationObservation.findFirst).mockResolvedValue(null);

            await evaluateMaturedCheckpoints('company-1');

            const stage2Inflows = vi.mocked(prisma.forecastEvaluationObservation.create).mock.calls
                .map(([input]) => input.data)
                .filter((data) => data.model === 'm1' && data.stage === 'stage2' && data.direction === 'inflow');

            expect(stage2Inflows).toHaveLength(13);
            expect(stage2Inflows.map((data) => data.horizonWeeks)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
            expect(stage2Inflows.map((data) => data.predictionAmount)).toEqual(predictions);
            expect(stage2Inflows[0].maturedWeekStart).toEqual(new Date('2024-01-01T00:00:00Z'));
            expect(stage2Inflows[12].maturedWeekStart).toEqual(new Date('2024-03-25T00:00:00Z'));
            expect(prisma.bankTransaction.findMany).toHaveBeenNthCalledWith(1, {
                where: {
                    companyId: 'company-1',
                    txDate: {
                        gte: new Date('2024-01-01T00:00:00Z'),
                        lt: new Date('2024-01-08T00:00:00Z')
                    }
                },
                include: { attributions: true }
            });
        });

        it('7. Missing or malformed prediction JSON produces an explicit failure', async () => {
            vi.mocked(prisma.forecastCheckpoint.findMany).mockResolvedValue([createMockCheckpoint({ m1PreAiResidualJson: null })] as any);

            await expect(evaluateMaturedCheckpoints('company-1')).rejects.toThrow('Evaluation failed for Checkpoint cp-1: missing or malformed prediction JSON');
            
            // No observations should be created
            expect(prisma.forecastEvaluationObservation.create).not.toHaveBeenCalled();
        });

        it('rejects a sealed checkpoint whose persisted horizon is incomplete', async () => {
            const checkpoint = createMockCheckpoint({});
            checkpoint.forecastWeeks = checkpoint.forecastWeeks.slice(0, 12);
            vi.mocked(prisma.forecastCheckpoint.findMany).mockResolvedValue([checkpoint] as any);

            await expect(evaluateMaturedCheckpoints('company-1')).rejects.toThrow(
                'Evaluation failed for Checkpoint cp-1: persisted forecast must contain exactly 13 weeks'
            );
            expect(prisma.bankTransaction.findMany).not.toHaveBeenCalled();
            expect(prisma.forecastEvaluationObservation.create).not.toHaveBeenCalled();
        });

        it('8. Reevaluation supersedes prior observations', async () => {
            vi.mocked(prisma.forecastCheckpoint.findMany).mockResolvedValue([
                createMockCheckpoint({}, { weekStart: new Date(Date.now() - 8 * 86_400_000) })
            ] as any);
            vi.mocked(bankCoverage.verifyBankCoverage).mockResolvedValue({ isVerified: true } as any);
            vi.mocked(attribution.calculateResidualActuals).mockReturnValue({ residualInflow: 100, residualOutflow: 200 } as any);
            
            // Mock finding an existing observation
            vi.mocked(prisma.forecastEvaluationObservation.findFirst).mockResolvedValue({ id: 'obs-1', version: 1 } as any);

            await evaluateMaturedCheckpoints('company-1');

            // Should call update to supersede
            expect(prisma.forecastEvaluationObservation.update).toHaveBeenCalledWith({
                where: { id: 'obs-1' },
                data: expect.objectContaining({ isLatest: false, supersededAt: expect.any(Date) })
            });

            // Should create with version 2
            const createCalls = vi.mocked(prisma.forecastEvaluationObservation.create).mock.calls;
            expect(createCalls[0][0].data.version).toBe(2);
        });
    });
});
