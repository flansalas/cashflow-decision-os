import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import prisma from '@/db/prisma';
import { evaluateCompanyDataReadiness, computeARPopulationHash } from '@/services/data-readiness-evaluation';
import { approveExecutionPlan } from '@/services/execution-plan-approval';
import { randomUUID } from 'crypto';

describe('Package 2B Readiness & Approval', () => {
    let companyId: string;
    let bankAccountId: string;
    let cashSnapshotId: string;
    let forecastCheckpointId: string;
    const now = new Date();

    beforeEach(async () => {
        companyId = randomUUID();
        await prisma.company.create({ data: { id: companyId, name: 'Test Co' } });

        bankAccountId = randomUUID();
        await prisma.bankAccount.create({
            data: { id: bankAccountId, companyId, accountName: 'Main Checking', isActive: true, currency: 'USD' }
        });

        cashSnapshotId = randomUUID();
        await prisma.cashSnapshot.create({
            data: { id: cashSnapshotId, companyId, asOfDate: now, bankBalance: 1000 }
        });

        const baseline = await prisma.baselineSnapshotHistory.create({
            data: { 
                id: randomUUID(), companyId, asOfDate: now, 
                variableInflowWeekly: 0, variableOutflowWeekly: 0,
                dataQualityStatus: 'valid',
                forecastCheckpointId: randomUUID()
            }
        });

        forecastCheckpointId = baseline.forecastCheckpointId;
        await prisma.forecastCheckpoint.create({
            data: {
                id: forecastCheckpointId, companyId, cashSnapshotId, weekStart: now, weekEnd: new Date(now.getTime() + 7 * 86400000),
                endCashExpected: 1000, inflowsExpected: 0, outflowsExpected: 0, sealedAt: now,
                generatedAt: now, forecastVersionHash: 'hash', canonicalPayloadJson: '{}', forecastSchemaVersion: 1, hashAlgorithm: 'sha256'
            }
        });
        
        for (let i = 0; i < 13; i++) {
            await prisma.forecastWeek.create({
                data: {
                    id: randomUUID(), forecastCheckpointId, weekStart: new Date(now.getTime() + i * 7 * 86400000),
                    inflows: 0, outflows: 0, startCash: 1000, endCash: 1000
                }
            });
        }
    });

    afterEach(async () => {
        await prisma.company.delete({ where: { id: companyId } });
    });

    it('missing certification produces operational_only', async () => {
        const result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId);
        expect(result.status).toBe('operational_only');
        expect(result.dimensions.bankCoverage.status).toBe('operational_only');
    });

    it('bank_no_activity attestation closes a gap, but new transactions invalidate it', async () => {
        // Attest no activity
        await prisma.dataReadinessAttestation.create({
            data: {
                companyId, scopeType: 'bank_no_activity', scopeKey: bankAccountId,
                asOfDate: now, sourceStateHash: 'test',
                evidenceJson: JSON.stringify({ coveredStartDate: new Date(0), coveredEndDate: new Date(now.getTime() + 10000) }),
                certifiedBy: 'test', status: 'active'
            }
        });

        let result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId);
        expect(result.dimensions.bankCoverage.status).toBe('decision_ready');

        // Add transaction inside interval
        await prisma.bankTransaction.create({
            data: { id: randomUUID(), companyId, accountId: bankAccountId, txDate: now, amount: 10, description: 'Test' }
        });

        result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId);
        expect(result.dimensions.bankCoverage.status).toBe('operational_only');
    });

    it('AR hidden state valid, exclude change invalidates', async () => {
        // Create an AR record
        const invId = randomUUID();
        await prisma.receivableInvoice.create({
            data: { id: invId, companyId, invoiceNo: '1', amountOpen: 100, dueDate: now, status: 'open', customerName: 'C1' }
        });

        const hash1 = await computeARPopulationHash(companyId);
        
        await prisma.dataReadinessAttestation.create({
            data: { companyId, scopeType: 'ar', asOfDate: now, sourceStateHash: hash1, evidenceJson: '{}', certifiedBy: 'test', status: 'active' }
        });

        let result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId);
        expect(result.dimensions.accountsReceivable.status).toBe('decision_ready');

        // Change exclude state
        await prisma.override.create({
            data: { id: randomUUID(), companyId, type: 'exclude', targetType: 'ReceivableInvoice', targetId: invId, status: 'active' }
        });

        result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId);
        expect(result.dimensions.accountsReceivable.status).toBe('operational_only');
    });

    it('exact checkpoint binding and same-date different cash snapshot rejection', async () => {
        // Make everything ready to get decision_ready
        // 1. Bank
        await prisma.dataReadinessAttestation.create({
            data: { companyId, scopeType: 'bank_no_activity', scopeKey: bankAccountId, asOfDate: now, sourceStateHash: '1', evidenceJson: JSON.stringify({ coveredStartDate: new Date(0), coveredEndDate: new Date(now.getTime() + 10000) }), certifiedBy: 'test', status: 'active' }
        });
        // 2. AR
        const arHash = await computeARPopulationHash(companyId);
        await prisma.dataReadinessAttestation.create({ data: { companyId, scopeType: 'ar', asOfDate: now, sourceStateHash: arHash, evidenceJson: '{}', certifiedBy: 'test', status: 'active' }});
        // 3. AP
        const apHash = await computeAPPopulationHash(companyId); // assuming computeAPPopulationHash exported too, but we can just use dummy if needed. Wait, we use evaluate... it will compute it.
        // I need to ensure evaluateCompanyDataReadiness passes.
    });
});
