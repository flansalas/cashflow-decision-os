import { describe, it, expect } from 'vitest';
import { computeVarianceMultipliers } from '../variance';
import { BaselineVarianceLedger } from '@prisma/client';

describe('Variance Multipliers', () => {
    const defaultLedger: BaselineVarianceLedger[] = [
        {
            id: '1', companyId: 'c1', weekStart: new Date('2026-07-13T04:00:00.000Z'),
            variancePct: 1.0, variancePctIn: 0.5, createdAt: new Date(), projectedOutflow: 0, actualOutflow: 0, projectedInflow: 0, actualInflow: 0
        },
        {
            id: '2', companyId: 'c1', weekStart: new Date('2026-07-13T00:00:00.000Z'),
            variancePct: -0.5, variancePctIn: -0.5, createdAt: new Date(), projectedOutflow: 0, actualOutflow: 0, projectedInflow: 0, actualInflow: 0
        },
        {
            id: '3', companyId: 'c1', weekStart: new Date('2026-07-06T00:00:00.000Z'),
            variancePct: 0.0, variancePctIn: 0.0, createdAt: new Date(), projectedOutflow: 0, actualOutflow: 0, projectedInflow: 0, actualInflow: 0
        }
    ];

    it('legacy ledger rows without verified evidence yield neutral 1.0 multipliers', () => {
        // Empty eligibleRowIds Set -> neutral multipliers
        const multipliers = computeVarianceMultipliers(defaultLedger, new Set());
        expect(multipliers.inflow).toBe(1.0);
        expect(multipliers.outflow).toBe(1.0);
    });

    it('eligible verified evidence can influence the multiplier when such evidence is genuinely available', () => {
        // All rows are eligible
        const multipliers = computeVarianceMultipliers(defaultLedger, new Set(['1', '2', '3']));
        // Expected behavior from deduplication:
        // Week 2 (id: 1) is kept: clipped to 0.75, weight 2
        // Week 1 (id: 3) is kept: clipped to 0.0, weight 1
        // Outflow avg: (0.75*2 + 0) / 3 = 0.5 -> multiplier 1.5
        // Inflow avg: (0.5*2 + 0) / 3 = 0.333 -> multiplier 1.333
        expect(multipliers.outflow).toBe(1.5);
        expect(multipliers.inflow).toBeCloseTo(1.333, 2);
    });

    it('duplicate weeks remain deduplicated even if both are verified', () => {
        const multipliers = computeVarianceMultipliers(defaultLedger, new Set(['1', '2', '3']));
        // If it weren't deduplicated, id: 2 (-0.5) would pull the average down significantly.
        expect(multipliers.outflow).toBe(1.5); 
    });

    it('unverified observations cannot influence M1', () => {
        // Only week 1 (id: 3) is verified. The aggressive 1.0 variance week is unverified.
        const multipliers = computeVarianceMultipliers(defaultLedger, new Set(['3']));
        // Week 1 has variance 0.0 -> multiplier 1.0
        expect(multipliers.outflow).toBe(1.0);
        expect(multipliers.inflow).toBe(1.0);
    });
});
