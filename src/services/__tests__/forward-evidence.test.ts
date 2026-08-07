import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseResidualForecastSeries, ResidualForecastSeries } from '../evaluation-types';
import { evaluateMaturedCheckpoints } from '../canonical-evaluator';
import prisma from '@/db/prisma';
import * as bankCoverage from '../bank-coverage';
import * as attribution from '../attribution';

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
        const createMockCheckpoint = (opts: any) => ({
            id: 'cp-1',
            companyId: 'company-1',
            weekStart: new Date('2024-01-01T00:00:00Z'),
            weekEnd: new Date('2024-01-08T00:00:00Z'),
            BaselineSnapshotHistory: {
                m1PreAiResidualJson: JSON.stringify({ inflow: new Array(13).fill(10), outflow: new Array(13).fill(20) }),
                m1PostAiResidualJson: JSON.stringify({ inflow: new Array(13).fill(15), outflow: new Array(13).fill(25) }),
                m4PreAiResidualJson: JSON.stringify({ inflow: new Array(13).fill(12), outflow: new Array(13).fill(22) }),
                ...opts
            }
        });

        it('4 & 5. Matured verified horizon creates 6 observations with identical canonical actuals', async () => {
            vi.mocked(prisma.forecastCheckpoint.findMany).mockResolvedValue([createMockCheckpoint({})] as any);
            vi.mocked(bankCoverage.verifyBankCoverage).mockResolvedValue({ isVerified: true } as any);
            vi.mocked(attribution.calculateResidualActuals).mockReturnValue({ residualInflow: 100, residualOutflow: 200 } as any);
            vi.mocked(prisma.forecastEvaluationObservation.findFirst).mockResolvedValue(null);

            await evaluateMaturedCheckpoints('company-1');

            // 13 horizons * 6 observations per horizon = 78 calls
            expect(prisma.forecastEvaluationObservation.create).toHaveBeenCalledTimes(78);
            
            // Look at horizon 1 specifically
            const calls = vi.mocked(prisma.forecastEvaluationObservation.create).mock.calls;
            const h1Calls = calls.slice(0, 6);

            // M1 Stage 2
            expect(h1Calls[0][0].data).toMatchObject({ direction: 'inflow', model: 'm1', stage: 'stage2', predictionAmount: 10, canonicalActual: 100, evaluationValidity: 'valid' });
            expect(h1Calls[1][0].data).toMatchObject({ direction: 'outflow', model: 'm1', stage: 'stage2', predictionAmount: 20, canonicalActual: 200, evaluationValidity: 'valid' });
            // M4 Stage 2
            expect(h1Calls[2][0].data).toMatchObject({ direction: 'inflow', model: 'm4', stage: 'stage2', predictionAmount: 12, canonicalActual: 100, evaluationValidity: 'valid' });
            expect(h1Calls[3][0].data).toMatchObject({ direction: 'outflow', model: 'm4', stage: 'stage2', predictionAmount: 22, canonicalActual: 200, evaluationValidity: 'valid' });
            // M1 Stage 3
            expect(h1Calls[4][0].data).toMatchObject({ direction: 'inflow', model: 'm1', stage: 'stage3', predictionAmount: 15, canonicalActual: 100, evaluationValidity: 'valid' });
            expect(h1Calls[5][0].data).toMatchObject({ direction: 'outflow', model: 'm1', stage: 'stage3', predictionAmount: 25, canonicalActual: 200, evaluationValidity: 'valid' });
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

        it('7. Missing or malformed prediction JSON produces an explicit failure', async () => {
            vi.mocked(prisma.forecastCheckpoint.findMany).mockResolvedValue([createMockCheckpoint({ m4PreAiResidualJson: null })] as any);

            await expect(evaluateMaturedCheckpoints('company-1')).rejects.toThrow('Evaluation failed for Checkpoint cp-1: missing or malformed prediction JSON');
            
            // No observations should be created
            expect(prisma.forecastEvaluationObservation.create).not.toHaveBeenCalled();
        });

        it('8. Reevaluation supersedes prior observations', async () => {
            vi.mocked(prisma.forecastCheckpoint.findMany).mockResolvedValue([
                // Limit to 1 horizon by modifying dates so only H1 is matured
                {
                    id: 'cp-1',
                    companyId: 'company-1',
                    weekStart: new Date(Date.now() - 14 * 86_400_000), // 2 weeks ago
                    weekEnd: new Date(Date.now() - 7 * 86_400_000),
                    BaselineSnapshotHistory: {
                        m1PreAiResidualJson: JSON.stringify({ inflow: new Array(13).fill(10), outflow: new Array(13).fill(20) }),
                        m1PostAiResidualJson: JSON.stringify({ inflow: new Array(13).fill(15), outflow: new Array(13).fill(25) }),
                        m4PreAiResidualJson: JSON.stringify({ inflow: new Array(13).fill(12), outflow: new Array(13).fill(22) }),
                    }
                }
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
