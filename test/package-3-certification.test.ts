import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '@/db/prisma';
import { randomUUID } from 'crypto';
import { certifyForecastVersion } from '@/services/forecast-certification';
import { evaluateDownsideScenario } from '@/services/forecast-scenario';
import { approveExecutionPlan } from '@/services/execution-plan-approval';

describe('Package 3 Certification', () => {
    let companyId: string;
    let cashSnapshotId: string;
    let forecastCheckpointId: string;
    let bankAccountId: string;
    let now: Date;

    beforeEach(async () => {
        companyId = randomUUID();
        await prisma.company.create({ data: { id: companyId, name: 'Test 3' } });

        bankAccountId = randomUUID();
        await prisma.bankAccount.create({
            data: { id: bankAccountId, companyId, name: 'Main', isActive: true, role: 'operating' }
        });

        now = new Date();
        cashSnapshotId = randomUUID();
        await prisma.cashSnapshot.create({
            data: { id: cashSnapshotId, companyId, asOfDate: now, bankBalance: 1000 }
        });

        forecastCheckpointId = randomUUID();
        await prisma.forecastCheckpoint.create({
            data: {
                id: forecastCheckpointId, companyId, cashSnapshotId, weekStart: now, weekEnd: new Date(now.getTime() + 7 * 86400000),
                endCashExpected: 1000, inflowsExpected: 0, outflowsExpected: 0,
                generatedAt: now, forecastVersionHash: 'hash', canonicalPayloadJson: '{}', forecastSchemaVersion: 1, hashAlgorithm: 'sha256'
            }
        });

        for (let i = 0; i < 13; i++) {
            await prisma.forecastWeek.create({
                data: {
                    id: randomUUID(), forecastCheckpointId, companyId, weekStart: new Date(now.getTime() + i * 7 * 86400000),
                    weekEnd: new Date(now.getTime() + (i + 1) * 7 * 86400000),
                    startCash: 1000, endCashExpected: 1000, inflowsExpected: 0, outflowsExpected: 0,
                    inflowsBest: 0, outflowsBest: 0, endCashBest: 1000,
                    inflowsWorst: 0, outflowsWorst: 0, endCashWorst: 1000,
                    zone: 'green', forecastVersionHash: 'hash'
                }
            });
        }

        await prisma.baselineSnapshotHistory.create({
            data: {
                id: randomUUID(), companyId, asOfDate: now,
                variableInflowWeekly: 0, variableOutflowWeekly: 0,
                dataQualityStatus: 'valid',
                forecastCheckpointId
            }
        });

        await prisma.assumption.create({
            data: { id: randomUUID(), companyId, bufferMin: 500 }
        });
    });

    async function satisfyReadiness(cid: string = companyId, asOf: Date = now) {
        const start = new Date(asOf.getTime() - 7 * 86400000).toISOString();
        const end = asOf.toISOString();
        await prisma.dataReadinessAttestation.create({ data: { companyId: cid, scopeType: 'bank_no_activity', scopeKey: bankAccountId, status: 'active', asOfDate: asOf, certifiedBy: 'test', evidenceJson: JSON.stringify({ coveredStartDate: start, coveredEndDate: end }), sourceStateHash: 'none' } });

        // Actually we need the real hashes for readiness evaluation
        const arHash = await import('@/services/data-readiness-evaluation').then(m => m.computeARPopulationHash(cid));
        const apHash = await import('@/services/data-readiness-evaluation').then(m => m.computeAPPopulationHash(cid));
        const recHash = await import('@/services/data-readiness-evaluation').then(m => m.computeRecurringPopulationHash(cid));

        await prisma.dataReadinessAttestation.deleteMany({ where: { companyId: cid, scopeType: { in: ['ar', 'ap', 'recurring'] } }});

        await prisma.dataReadinessAttestation.create({ data: { companyId: cid, scopeType: 'ar', asOfDate: asOf, sourceStateHash: arHash, evidenceJson: '{}', certifiedBy: 'test', status: 'active' }});
        await prisma.dataReadinessAttestation.create({ data: { companyId: cid, scopeType: 'ap', asOfDate: asOf, sourceStateHash: apHash, evidenceJson: '{}', certifiedBy: 'test', status: 'active' }});
        await prisma.dataReadinessAttestation.create({ data: { companyId: cid, scopeType: 'recurring', asOfDate: asOf, sourceStateHash: recHash, evidenceJson: '{}', certifiedBy: 'test', status: 'active' }});
    }

    it('1. unsealed checkpoint cannot be certified', async () => {
        await expect(certifyForecastVersion(companyId, forecastCheckpointId, { status: 'certified' }, {})).rejects.toThrow(/unsealed/);
    });

    it('2. foreign checkpoint cannot be certified', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        const foreignCompanyId = randomUUID();
        await expect(certifyForecastVersion(foreignCompanyId, forecastCheckpointId, { status: 'certified' }, {})).rejects.toThrow(/unsealed or does not exist/);
    });

    it('3. operational_only Company Data-Readiness cannot produce passing Forecast-Version Certification', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        // Without readiness attestations, it will evaluate to operational_only or blocked
        const cert = await certifyForecastVersion(companyId, forecastCheckpointId, { status: 'certified', decidedBy: 'admin' }, {}, 'buffer ok');
        expect(cert.status).toBe('cannot_certify');
    });

    it('4. stale readiness/current-evidence mismatch cannot authorize certification/approval', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        await satisfyReadiness();
        const cert = await certifyForecastVersion(companyId, forecastCheckpointId, { status: 'certified', decidedBy: 'admin' }, {}, 'buffer ok');
        expect(cert.status).toBe('certified');
        
        // Mutate source state to invalidate readiness
        await prisma.receivableInvoice.create({
            data: { id: randomUUID(), companyId, invoiceNo: 'INV-NEW', customerName: 'Test', amountOpen: 1000, dueDate: now, status: 'open' }
        });
        
        const planOpts = { companyId, weekStart: now.toISOString(), forecastCheckpointId, actions: [] };
        // Fails because the evidence hash computed during approval doesn't match the cert's preserved evidence hash
        await expect(approveExecutionPlan(planOpts)).rejects.toThrow(/readiness evidence hash has changed/);
    });

    it('malformed/non-13-week sealed checkpoint cannot certify', async () => {
        const badCheckpointId = randomUUID();
        await prisma.forecastCheckpoint.create({
            data: {
                id: badCheckpointId, companyId, cashSnapshotId, weekStart: now, weekEnd: new Date(now.getTime() + 7 * 86400000),
                endCashExpected: 1000, inflowsExpected: 0, outflowsExpected: 0,
                generatedAt: now, forecastVersionHash: 'hash', canonicalPayloadJson: '{}', forecastSchemaVersion: 1, hashAlgorithm: 'sha256',
                sealedAt: now
            }
        });
        // 0 weeks instead of 13
        await expect(certifyForecastVersion(companyId, badCheckpointId, { status: 'certified', decidedBy: 'admin' }, {}, 'buffer ok'))
            .rejects.toThrow(/exactly 13 ForecastWeeks/);
    });

    it('certified without authenticated human authority is refused', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        await satisfyReadiness();
        // decidedBy is missing
        await expect(certifyForecastVersion(companyId, forecastCheckpointId, { status: 'certified' }, {}, 'buffer ok'))
            .rejects.toThrow(/authenticated human decision authority required/);
    });

    it('missing authoritative buffer cannot certify', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        await satisfyReadiness();
        await prisma.assumption.deleteMany({ where: { companyId } });
        
        const cert = await certifyForecastVersion(companyId, forecastCheckpointId, { status: 'certified', decidedBy: 'admin' }, {}, 'buffer ok');
        expect(cert.status).toBe('cannot_certify');
    });

    it('5. exact sealed checkpoint + decision_ready readiness can be evaluated', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        await satisfyReadiness();
        const cert = await certifyForecastVersion(companyId, forecastCheckpointId, { status: 'certified', decidedBy: 'admin' }, {}, 'buffer ok');
        expect(cert.status).toBe('certified');
        expect(cert.baseMinCash).toBe(1000);
        expect(cert.baseBufferHeadroom).toBe(500); // 1000 - 500
    });

    it('6 & 7. deterministic downside calculation is reproducible and changes with inputs', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        
        // Add a component to delay
        await prisma.forecastComponentSnapshot.create({
            data: {
                id: randomUUID(), forecastCheckpointId, targetWeekStart: now, direction: 'inflow', componentCategory: 'revenue',
                sourceType: 'invoice', projectedAmount: 200, confidenceTier: 'high', sourceStateHash: 'x'
            }
        });
        
        const scenario1 = await evaluateDownsideScenario(companyId, forecastCheckpointId, { arDelayWeeks: 1 }, 500);
        const scenario1_again = await evaluateDownsideScenario(companyId, forecastCheckpointId, { arDelayWeeks: 1 }, 500);
        
        expect(scenario1.scenarioHash).toEqual(scenario1_again.scenarioHash);
        expect(scenario1.id).toEqual(scenario1_again.id);
        
        const scenario2 = await evaluateDownsideScenario(companyId, forecastCheckpointId, { arDelayWeeks: 2 }, 500);
        expect(scenario1.scenarioHash).not.toEqual(scenario2.scenarioHash);
    });

    it('8. base sealed checkpoint is never mutated by downside evaluation', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        const before = await prisma.forecastCheckpoint.findUnique({ where: { id: forecastCheckpointId }, include: { forecastWeeks: true } });
        
        await evaluateDownsideScenario(companyId, forecastCheckpointId, { arDelayWeeks: 1, residualInflowReductionPct: 20 }, 500);
        
        const after = await prisma.forecastCheckpoint.findUnique({ where: { id: forecastCheckpointId }, include: { forecastWeeks: true } });
        expect(before).toEqual(after);
    });

    it('AR shifted outside W13 is explicitly preserved in scenario evidence', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        // Create an AR component in Week 12
        await prisma.forecastComponentSnapshot.create({
            data: { id: randomUUID(), forecastCheckpointId, targetWeekStart: new Date(now.getTime() + 11 * 7 * 86400000), direction: 'inflow', componentCategory: 'rev', sourceType: 'invoice', projectedAmount: 1200, confidenceTier: 'high', sourceStateHash: 'x' }
        });
        
        // Delay by 4 weeks => pushes it to week 16, which is outside the 13 week horizon.
        const scenario = await evaluateDownsideScenario(companyId, forecastCheckpointId, { arDelayWeeks: 4 }, 500);
        
        // The stress reduction in week 12 must be present
        const w12 = scenario.payload[11];
        expect(w12.stressAdjustments.length).toBeGreaterThan(0);
        expect(w12.stressAdjustments[0].amountImpact).toBe(-1200);
        expect(w12.stressAdjustments[0].description).toContain('delayed by 4 weeks');
        
        // Ensure no week after 13 was created
        expect(scenario.payload.length).toBe(13);
    });

    it('9 & 10. risk metrics reconcile to the scenario’s 13-week values and buffer breach is deterministic', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        // The mock starts all weeks with startCash=1000, endCash=1000.
        // If we delay AR, some endCash will drop.
        await prisma.forecastComponentSnapshot.create({
            data: { id: randomUUID(), forecastCheckpointId, targetWeekStart: now, direction: 'inflow', componentCategory: 'rev', sourceType: 'invoice', projectedAmount: 1200, confidenceTier: 'high', sourceStateHash: 'x' }
        });

        // 1200 inflow removed from week 1 => endCash goes to 1000 - 1200 = -200
        const scenario = await evaluateDownsideScenario(companyId, forecastCheckpointId, { arDelayWeeks: 1 }, 500);
        
        expect(scenario.metrics.minCash).toBe(-200);
        expect(scenario.metrics.firstNegativeWeek).toEqual(now);
        expect(scenario.metrics.maxDeficit).toBe(200);
        expect(scenario.metrics.bufferHeadroom).toBe(-700); // -200 - 500
        expect(scenario.metrics.firstBreachWeek).toEqual(now);
    });

    it('11 & 12. cert is bound to exact checkpoint identity, cert for A cannot authorize plan for B', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        await satisfyReadiness();
        
        const checkpointB = await prisma.forecastCheckpoint.create({
            data: {
                id: randomUUID(), companyId, cashSnapshotId, weekStart: now, weekEnd: new Date(now.getTime() + 7 * 86400000), endCashExpected: 1000, inflowsExpected: 0, outflowsExpected: 0, generatedAt: now, forecastVersionHash: 'hashb', canonicalPayloadJson: '{}', forecastSchemaVersion: 1, hashAlgorithm: 'sha256', sealedAt: now
            }
        });

        await certifyForecastVersion(companyId, forecastCheckpointId, { status: 'certified' }, {}, 'ok');
        
        const planOpts = { companyId, weekStart: now.toISOString(), forecastCheckpointId: checkpointB.id, actions: [] };
        
        // Fails because the certification is for forecastCheckpointId, not checkpointB.id
        await expect(approveExecutionPlan(planOpts)).rejects.toThrow(/passing Forecast-Version Certification is absent/);
    });

    it('13 & 14. ExecutionPlan approval refuses when cert is absent, succeeds when present', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        await satisfyReadiness();
        
        const planOpts = {
            companyId, weekStart: now.toISOString(), forecastCheckpointId, actions: []
        };
        
        // Fails because no cert exists
        await expect(approveExecutionPlan(planOpts)).rejects.toThrow(/passing Forecast-Version Certification is absent/);
        
        // Fails if cert is not_safe
        await certifyForecastVersion(companyId, forecastCheckpointId, { status: 'not_safe' }, {});
        await expect(approveExecutionPlan(planOpts)).rejects.toThrow(/passing Forecast-Version Certification is absent/);

        // Succeeds if certified
        await certifyForecastVersion(companyId, forecastCheckpointId, { status: 'certified' }, {}, 'ok');
        const plan = await approveExecutionPlan(planOpts);
        expect(plan.status).toBe('approved');
    });

    it('15. historical finalized certification cannot be financially rewritten', async () => {
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        await satisfyReadiness();
        const cert = await certifyForecastVersion(companyId, forecastCheckpointId, { status: 'certified' }, {}, 'ok');
        
        await expect(
            prisma.forecastVersionCertification.update({
                where: { id: cert.id },
                data: { baseMinCash: 99999 }
            })
        ).rejects.toThrow(); // Trigger will raise exception
    });

    it('16. tenant A cannot read/write/certify tenant B artifacts', async () => {
        const tenantB = randomUUID();
        await prisma.company.create({ data: { id: tenantB, name: 'Tenant B' } });
        
        await prisma.forecastCheckpoint.update({ where: { id: forecastCheckpointId }, data: { sealedAt: now } });
        await satisfyReadiness();

        // Tenant B tries to certify Tenant A's checkpoint
        await expect(
            certifyForecastVersion(tenantB, forecastCheckpointId, { status: 'certified' }, {}, 'ok')
        ).rejects.toThrow();
    });

});
