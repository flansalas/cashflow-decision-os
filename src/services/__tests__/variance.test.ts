import { describe, it, expect } from 'vitest';
import { computeVarianceMultipliers } from '../variance';
import { BaselineVarianceLedger } from '@prisma/client';

describe('Variance Multipliers', () => {
    it('should deduplicate timezone-shifted rows for the same calendar week', () => {
        // Two rows for the exact same calendar week (one at midnight, one at 4am)
        const ledger: BaselineVarianceLedger[] = [
            {
                id: '1',
                companyId: 'c1',
                weekStart: new Date('2026-07-13T04:00:00.000Z'),
                variancePct: 1.0, 
                variancePctIn: 0.5,
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: '2',
                companyId: 'c1',
                weekStart: new Date('2026-07-13T00:00:00.000Z'),
                variancePct: -0.5, // These extreme opposites would cancel out if double-counted
                variancePctIn: -0.5,
                createdAt: new Date(),
                updatedAt: new Date()
            },
            {
                id: '3',
                companyId: 'c1',
                weekStart: new Date('2026-07-06T00:00:00.000Z'),
                variancePct: 0.0,
                variancePctIn: 0.0,
                createdAt: new Date(),
                updatedAt: new Date()
            }
        ];

        const multipliers = computeVarianceMultipliers(ledger);
        
        // Due to deduplication, the 1.0 variance from 04:00:00Z should be kept,
        // and the -0.5 variance from 00:00:00Z should be discarded.
        // The remaining valid items are:
        // Week 2: 1.0 (weight 2)
        // Week 1: 0.0 (weight 1)
        // Note: values are clipped at +/- 0.75
        // Clipped: 0.75 (weight 2), 0.0 (weight 1)
        // Weighted sum = 0.75 * 2 + 0.0 = 1.5
        // Sum weights = 3
        // Avg = 0.5
        // Multiplier = 1 + 0.5 = 1.5
        expect(multipliers.outflow).toBe(1.5);
    });
});
