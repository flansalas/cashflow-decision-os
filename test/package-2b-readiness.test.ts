import { describe, it, expect, beforeEach } from 'vitest';
import prisma from '@/db/prisma';
import { evaluateCompanyDataReadiness, computeARPopulationHash, computeAPPopulationHash, computeRecurringPopulationHash } from '@/services/data-readiness-evaluation';
import { randomUUID } from 'crypto';

describe('Package 2B Data Readiness', () => {
    let companyId: string;
    let cashSnapshotId: string;
    let bankAccountId: string;
    let forecastCheckpointId: string;

    beforeEach(async () => {
        companyId = randomUUID();
        await prisma.company.create({ data: { id: companyId, name: 'Test 2B' } });

        bankAccountId = randomUUID();
        await prisma.bankAccount.create({
            data: { id: bankAccountId, companyId, name: 'Main', isActive: true, role: 'operating' }
        });

        const now = new Date();
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

        forecastCheckpointId = baseline.forecastCheckpointId!;
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
                    id: randomUUID(), forecastCheckpointId, companyId, weekStart: new Date(now.getTime() + i * 7 * 86400000),
                    weekEnd: new Date(now.getTime() + (i + 1) * 7 * 86400000),
                    startCash: 1000, endCashExpected: 1000, inflowsExpected: 0, outflowsExpected: 0,
                    inflowsBest: 0, outflowsBest: 0, endCashBest: 1000,
                    inflowsWorst: 0, outflowsWorst: 0, endCashWorst: 1000,
                    zone: 'green', forecastVersionHash: 'hash'
                }
            });
        }
    });

    it('missing certification => operational_only', async () => {
        const result = await evaluateCompanyDataReadiness(companyId, new Date(), cashSnapshotId, forecastCheckpointId);
        expect(result.status).toBe('operational_only');
    });

    it('uncertified bank blocks decision_ready', async () => {
        const result = await evaluateCompanyDataReadiness(companyId, new Date(), cashSnapshotId, forecastCheckpointId);
        expect(result.dimensions.bankCoverage.status).toBe('operational_only');
    });

    it('certified interval ending at cutoff but starting too late => operational_only', async () => {
        const now = new Date();
        const start = new Date(now.getTime() - 2 * 86400000); // Only 2 days ago, required is 7

        await prisma.bankImportManifestAccount.create({
            data: {
                id: randomUUID(),
                BankAccount: { connect: { id: bankAccountId } },
                importSuccess: true,
                rejectedRowCount: 0,
                coveredStartDate: start,
                coveredEndDate: now,
                BankImportManifest: {
                    create: { id: randomUUID(), companyId, userCertified: true }
                }
            }
        });

        const result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId, forecastCheckpointId);
        expect(result.dimensions.bankCoverage.status).toBe('operational_only');
    });

    it('exact no-activity bridge closes a real gap', async () => {
        const now = new Date();
        const gapStart = new Date(now.getTime() - 7 * 86400000); // 7 days ago
        const gapEnd = new Date(now.getTime() - 2 * 86400000); // 2 days ago

        // Manifest covers last 2 days
        await prisma.bankImportManifestAccount.create({
            data: {
                id: randomUUID(), BankAccount: { connect: { id: bankAccountId } },
                importSuccess: true, rejectedRowCount: 0,
                coveredStartDate: gapEnd, coveredEndDate: now,
                BankImportManifest: { create: { id: randomUUID(), companyId, userCertified: true } }
            }
        });

        // No-activity bridges exactly the 5-day gap
        await prisma.dataReadinessAttestation.create({
            data: { companyId, scopeType: 'bank_no_activity', scopeKey: bankAccountId, status: 'active', asOfDate: now, certifiedBy: 'test', evidenceJson: JSON.stringify({ coveredStartDate: gapStart.toISOString(), coveredEndDate: gapEnd.toISOString() }), sourceStateHash: 'none' }
        });

        const result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId, forecastCheckpointId);
        expect(result.dimensions.bankCoverage.status).toBe('decision_ready');

        // tx inside invalidates
        await prisma.bankTransaction.create({
            data: { id: randomUUID(), companyId, accountId: bankAccountId, txDate: new Date(now.getTime() - 4 * 86400000), amount: 10, direction: 'inflow', description: 'Test' }
        });

        const r2 = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId, forecastCheckpointId);
        expect(r2.dimensions.bankCoverage.status).toBe('operational_only');
    });

    it('matching hash + stale asOfDate => operational_only', async () => {
        const now = new Date();
        const staleDate = new Date(now.getTime() - 86400000); // Yesterday

        const arHash = await computeARPopulationHash(companyId);
        await prisma.dataReadinessAttestation.create({ data: { companyId, scopeType: 'ar', asOfDate: staleDate, sourceStateHash: arHash, evidenceJson: '{}', certifiedBy: 'test', status: 'active' }});

        const result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId, forecastCheckpointId);
        expect(result.dimensions.accountsReceivable.status).toBe('operational_only');
    });

    it('source state changes invalidate readiness', async () => {
        const now = new Date();
        const start = new Date(now.getTime() - 7 * 86400000).toISOString(); // 7 days ago
        const end = now.toISOString();

        // Satisfy bank
        await prisma.dataReadinessAttestation.create({ data: { companyId, scopeType: 'bank_no_activity', scopeKey: bankAccountId, status: 'active', asOfDate: now, certifiedBy: 'test', evidenceJson: JSON.stringify({ coveredStartDate: start, coveredEndDate: end }), sourceStateHash: 'none' } });

        // Satisfy AR
        let arHash = await computeARPopulationHash(companyId);
        await prisma.dataReadinessAttestation.create({ data: { companyId, scopeType: 'ar', asOfDate: now, sourceStateHash: arHash, evidenceJson: '{}', certifiedBy: 'test', status: 'active' }});

        // Satisfy AP
        let apHash = await computeAPPopulationHash(companyId);
        await prisma.dataReadinessAttestation.create({ data: { companyId, scopeType: 'ap', asOfDate: now, sourceStateHash: apHash, evidenceJson: '{}', certifiedBy: 'test', status: 'active' }});

        // Satisfy recurring
        let recHash = await computeRecurringPopulationHash(companyId);
        await prisma.dataReadinessAttestation.create({ data: { companyId, scopeType: 'recurring', asOfDate: now, sourceStateHash: recHash, evidenceJson: '{}', certifiedBy: 'test', status: 'active' }});

        let result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId, forecastCheckpointId);
        expect(result.status).toBe('decision_ready');

        // AR change
        const inv = await prisma.receivableInvoice.create({
            data: { id: randomUUID(), companyId, customerName: 'C1', invoiceNo: '1', amountOpen: 100, dueDate: now, status: 'open' }
        });
        result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId, forecastCheckpointId);
        expect(result.dimensions.accountsReceivable.status).toBe('operational_only');

        // Exclude it
        await prisma.override.create({
            data: { id: randomUUID(), companyId, type: 'exclude', targetType: 'ReceivableInvoice', targetId: inv.id, status: 'active', metaJson: '{}' }
        });

        arHash = await computeARPopulationHash(companyId);
        await prisma.dataReadinessAttestation.create({ data: { companyId, scopeType: 'ar', asOfDate: now, sourceStateHash: arHash, evidenceJson: '{}', certifiedBy: 'test', status: 'active' }});

        result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId, forecastCheckpointId);
        expect(result.status).toBe('decision_ready'); // Valid hidden AR can be certified

        // AP change
        await prisma.payableBill.create({
            data: { id: randomUUID(), companyId, vendorName: 'V1', billNo: '1', amountOpen: 100, dueDate: now, status: 'open' }
        });
        result = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId, forecastCheckpointId);
        expect(result.dimensions.accountsPayable.status).toBe('operational_only');
    });

    it('current unresolved possible_match blocks', async () => {
        await prisma.stagedImportRow.create({
            data: { id: randomUUID(), companyId, importBatchId: randomUUID(), conflictType: 'possible_match', importType: 'bank', sourceRowNumber: 1, rawDataJson: '{}', normalizedDataJson: '{}', validationStatus: 'valid', proposedAction: 'none' }
        });
        const result = await evaluateCompanyDataReadiness(companyId, new Date(), cashSnapshotId, forecastCheckpointId);
        expect(result.dimensions.unresolvedConflicts.status).toBe('blocked');
    });
});
