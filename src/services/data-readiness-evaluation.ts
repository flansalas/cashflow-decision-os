import prismaClient from "@/db/prisma";
import { Prisma } from "@prisma/client";
import { computeCanonicalHash, canonicalJsonSerialize } from "./canonical-hash";
import { verifyBankCoverage } from "./bank-coverage";

export type ReadinessStatus = 'decision_ready' | 'operational_only' | 'blocked';

export interface DataReadinessResult {
    status: ReadinessStatus;
    asOfDate: Date;
    cashSnapshotId: string;
    dimensions: {
        startingCash: { status: ReadinessStatus; detail: string; cashSnapshotId?: string };
        bankCoverage: { status: ReadinessStatus; detail: string };
        accountsReceivable: { status: ReadinessStatus; detail: string };
        accountsPayable: { status: ReadinessStatus; detail: string };
        recurringPatterns: { status: ReadinessStatus; detail: string };
        unresolvedConflicts: { status: ReadinessStatus; detail: string };
        baselineProvenance: { status: ReadinessStatus; detail: string };
    };
    blockingReasons: string[];
}

export async function computeARPopulationHash(companyId: string, tx: Prisma.TransactionClient = prismaClient): Promise<string> {
    const invoices = await tx.receivableInvoice.findMany({
        where: { companyId },
        orderBy: { id: 'asc' },
        select: { id: true, customerName: true, invoiceNo: true, amountOpen: true, dueDate: true, status: true }
    });

    const overrides = await tx.override.findMany({
        where: { companyId, type: 'exclude', targetType: 'ReceivableInvoice', status: 'active' }
    });
    const excludedIds = new Set(overrides.map(o => o.targetId));

    const hashedData = invoices.map(inv => ({
        id: inv.id,
        customerName: inv.customerName,
        invoiceNo: inv.invoiceNo,
        amountOpen: inv.amountOpen,
        dueDate: inv.dueDate?.toISOString() || null,
        status: inv.status,
        managerialExcluded: excludedIds.has(inv.id)
    }));

    return computeCanonicalHash(canonicalJsonSerialize(hashedData));
}

export async function computeAPPopulationHash(companyId: string, tx: Prisma.TransactionClient = prismaClient): Promise<string> {
    const bills = await tx.payableBill.findMany({
        where: { companyId },
        orderBy: { id: 'asc' },
        select: { id: true, vendorName: true, billNo: true, amountOpen: true, dueDate: true, status: true }
    });

    const overrides = await tx.override.findMany({
        where: { companyId, type: 'exclude', targetType: 'PayableBill', status: 'active' }
    });
    const excludedIds = new Set(overrides.map(o => o.targetId));

    const hashedData = bills.map(b => ({
        id: b.id,
        vendorName: b.vendorName,
        billNo: b.billNo,
        amountOpen: b.amountOpen,
        dueDate: b.dueDate?.toISOString() || null,
        status: b.status,
        managerialExcluded: excludedIds.has(b.id)
    }));

    return computeCanonicalHash(canonicalJsonSerialize(hashedData));
}

export async function computeRecurringPopulationHash(companyId: string, tx: Prisma.TransactionClient = prismaClient): Promise<string> {
    const patterns = await tx.recurringPattern.findMany({
        where: { companyId },
        orderBy: { id: 'asc' },
        select: { id: true, merchantKey: true, typicalAmount: true, cadence: true, nextExpectedDate: true, isIncluded: true, status: true, origin: true, isCritical: true }
    });

    const assumptions = await tx.assumption.findFirst({
        where: { companyId },
        select: { payrollCadence: true, payrollAllInAmount: true, payrollNextDate: true, rentMonthlyAmount: true, rentDayOfMonth: true }
    });

    const payload = {
        patterns: patterns.map(p => ({
            id: p.id,
            merchantKey: p.merchantKey,
            typicalAmount: p.typicalAmount,
            cadence: p.cadence,
            nextExpectedDate: p.nextExpectedDate?.toISOString() || null,
            isIncluded: p.isIncluded,
            status: p.status,
            origin: p.origin,
            isCritical: p.isCritical
        })),
        assumptions: assumptions ? {
            payrollCadence: assumptions.payrollCadence,
            payrollAllInAmount: assumptions.payrollAllInAmount,
            payrollNextDate: assumptions.payrollNextDate?.toISOString() || null,
            rentMonthlyAmount: assumptions.rentMonthlyAmount,
            rentDayOfMonth: assumptions.rentDayOfMonth
        } : null
    };

    return computeCanonicalHash(canonicalJsonSerialize(payload));
}

export async function evaluateCompanyDataReadiness(
    companyId: string, 
    asOfDate: Date,
    requiredCashSnapshotId?: string,
    forecastCheckpointId?: string,
    tx: Prisma.TransactionClient = prismaClient
): Promise<DataReadinessResult> {
    const result: DataReadinessResult = {
        status: 'decision_ready',
        asOfDate,
        cashSnapshotId: requiredCashSnapshotId || '',
        dimensions: {
            startingCash: { status: 'decision_ready', detail: 'OK' },
            bankCoverage: { status: 'decision_ready', detail: 'OK' },
            accountsReceivable: { status: 'decision_ready', detail: 'OK' },
            accountsPayable: { status: 'decision_ready', detail: 'OK' },
            recurringPatterns: { status: 'decision_ready', detail: 'OK' },
            unresolvedConflicts: { status: 'decision_ready', detail: 'OK' },
            baselineProvenance: { status: 'decision_ready', detail: 'OK' },
        },
        blockingReasons: []
    };

    const auditEvidence: any = {
        evaluationAsOfDate: asOfDate.toISOString(),
        forecastCheckpointId: forecastCheckpointId || null,
        bankAccounts: []
    };

    // 1. STARTING CASH
    const sevenDaysAgo = new Date(asOfDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    let latestCash;
    if (requiredCashSnapshotId) {
        latestCash = await tx.cashSnapshot.findUnique({ where: { id: requiredCashSnapshotId } });
        if (!latestCash || latestCash.companyId !== companyId) latestCash = null;
    } else {
        latestCash = await tx.cashSnapshot.findFirst({
            where: { companyId },
            orderBy: { asOfDate: 'desc' }
        });
    }

    if (!latestCash) {
        result.dimensions.startingCash = { status: 'blocked', detail: 'No required CashSnapshot exists' };
        result.blockingReasons.push('No required CashSnapshot exists');
    } else {
        result.cashSnapshotId = latestCash.id;
        result.dimensions.startingCash.cashSnapshotId = latestCash.id;
        auditEvidence.cashSnapshotId = latestCash.id;
        if (latestCash.asOfDate < sevenDaysAgo) {
            result.dimensions.startingCash = { status: 'operational_only', detail: 'CashSnapshot is stale (older than 7 days)' };
        } else {
            const cashMismatch = await tx.companyNote.findFirst({
                where: { companyId, noteText: { contains: 'cash mismatch' } }
            });
            if (cashMismatch) {
                result.dimensions.startingCash = { status: 'blocked', detail: 'Unresolved material cash mismatch' };
                result.blockingReasons.push('Unresolved material cash mismatch');
            }
        }
    }

    // 2. BANK COVERAGE
    // Verify coverage up to the cash snapshot's asOfDate
    const targetCutoff = latestCash ? latestCash.asOfDate : asOfDate;
    // We check coverage by utilizing verifyBankCoverage. Wait, verifyBankCoverage expects weekStart/weekEnd.
    // Instead of using verifyBankCoverage directly which checks a specific week window,
    // we must verify that EVERY active bank account has coverage continuously through the cutoff.
    
    const activeAccounts = await tx.bankAccount.findMany({
        where: { companyId, isActive: true }
    });

    let bankCoverageOperational = false;
    
    for (const ba of activeAccounts) {
        const latestManifestAccount = await tx.bankImportManifestAccount.findFirst({
            where: { 
                bankAccountId: ba.id,
                importSuccess: true,
                rejectedRowCount: 0,
                BankImportManifest: { userCertified: true }
            },
            orderBy: { coveredEndDate: 'desc' },
            include: { BankImportManifest: true }
        });

        let accountCovered = false;
        let bankEvidenceEntry: any = { accountId: ba.id };

        if (latestManifestAccount && latestManifestAccount.coveredEndDate && latestManifestAccount.coveredEndDate >= targetCutoff) {
            accountCovered = true;
            bankEvidenceEntry.manifestId = latestManifestAccount.manifestId;
            bankEvidenceEntry.coveredEndDate = latestManifestAccount.coveredEndDate.toISOString();
        }

        if (!accountCovered) {
            // Check for explicit bank_no_activity attestation that bridges the gap
            const noActivityAttestation = await tx.dataReadinessAttestation.findFirst({
                where: { companyId, scopeType: 'bank_no_activity', scopeKey: ba.id, status: 'active' }
            });

            if (noActivityAttestation) {
                // Parse evidence to see if it covers up to targetCutoff
                try {
                    const evidence = JSON.parse(noActivityAttestation.evidenceJson);
                    const attestedEnd = new Date(evidence.coveredEndDate);
                    if (!isNaN(attestedEnd.getTime()) && attestedEnd >= targetCutoff) {
                        // Check if any transactions actually occurred in the interval
                        const txInGap = await tx.bankTransaction.findFirst({
                            where: { 
                                companyId, 
                                accountId: ba.id, 
                                txDate: { gte: new Date(evidence.coveredStartDate), lte: attestedEnd }
                            }
                        });
                        if (!txInGap) {
                            accountCovered = true;
                            bankEvidenceEntry.noActivityAttestationId = noActivityAttestation.id;
                            bankEvidenceEntry.coveredStartDate = evidence.coveredStartDate;
                            bankEvidenceEntry.coveredEndDate = evidence.coveredEndDate;
                        }
                    }
                } catch (e) {
                    // Invalid evidence JSON
                }
            }
        }

        auditEvidence.bankAccounts.push(bankEvidenceEntry);

        if (!accountCovered) {
            bankCoverageOperational = true;
        }
    }

    if (activeAccounts.length === 0) {
        // Having 0 bank accounts doesn't make bank coverage decision ready.
        bankCoverageOperational = true;
    }

    if (bankCoverageOperational) {
        result.dimensions.bankCoverage = { status: 'operational_only', detail: 'Missing or uncertified coverage through the cash cutoff for some active accounts' };
    }

    // 3. AR
    const arHash = await computeARPopulationHash(companyId, tx);
    auditEvidence.arSourceStateHash = arHash;
    const arAttestation = await tx.dataReadinessAttestation.findFirst({
        where: { companyId, scopeType: 'ar', status: 'active', sourceStateHash: arHash }
    });
    if (!arAttestation) {
        result.dimensions.accountsReceivable = { status: 'operational_only', detail: 'Active AR attestation does not match current source state' };
    } else {
        auditEvidence.arAttestation = { id: arAttestation.id, certifiedAt: arAttestation.certifiedAt?.toISOString() || arAttestation.createdAt.toISOString() };
    }

    // 4. AP
    const apHash = await computeAPPopulationHash(companyId, tx);
    auditEvidence.apSourceStateHash = apHash;
    const apAttestation = await tx.dataReadinessAttestation.findFirst({
        where: { companyId, scopeType: 'ap', status: 'active', sourceStateHash: apHash }
    });
    if (!apAttestation) {
        result.dimensions.accountsPayable = { status: 'operational_only', detail: 'Active AP attestation does not match current source state' };
    } else {
        auditEvidence.apAttestation = { id: apAttestation.id, certifiedAt: apAttestation.certifiedAt?.toISOString() || apAttestation.createdAt.toISOString() };
    }

    // 5. RECURRING
    const recurringHash = await computeRecurringPopulationHash(companyId, tx);
    auditEvidence.recurringSourceStateHash = recurringHash;
    const recurringAttestation = await tx.dataReadinessAttestation.findFirst({
        where: { companyId, scopeType: 'recurring', status: 'active', sourceStateHash: recurringHash }
    });
    if (!recurringAttestation) {
        result.dimensions.recurringPatterns = { status: 'operational_only', detail: 'Active Recurring attestation does not match current source state' };
    } else {
        auditEvidence.recurringAttestation = { id: recurringAttestation.id, certifiedAt: recurringAttestation.certifiedAt?.toISOString() || recurringAttestation.createdAt.toISOString() };
    }

    // 6. UNRESOLVED CONFLICTS
    const unresolvedStagedCount = await tx.stagedImportRow.count({
        where: {
            companyId,
            conflictType: 'possible_match',
            userDecision: null
        }
    });
    const failedCurrentApply = await tx.importApplication.count({
        where: { companyId, status: 'failed' } // current
    });
    const contradictoryEvidence = await tx.companyNote.count({
        where: { companyId, noteText: { contains: 'contradictory' } }
    });
    const unresolvedEconomicOverlap = await tx.reconciliationLink.count({
        where: { companyId, status: 'conflict' }
    });

    if (unresolvedStagedCount > 0 || failedCurrentApply > 0 || contradictoryEvidence > 0 || unresolvedEconomicOverlap > 0) {
        result.dimensions.unresolvedConflicts = { status: 'blocked', detail: 'Unresolved current unsafe conflicts exist' };
        result.blockingReasons.push('Unresolved current unsafe conflicts exist');
    }

    // 7. BASELINE PROVENANCE
    const latestBaseline = await tx.baselineSnapshotHistory.findFirst({
        where: { companyId },
        orderBy: { generatedAt: 'desc' }
    });
    if (!latestBaseline || latestBaseline.dataQualityStatus !== 'valid') {
        result.dimensions.baselineProvenance = { status: 'operational_only', detail: 'Baseline lacks proper provenance or relies on low-confidence evidence' };
    } else {
        auditEvidence.baselineProvenance = { id: latestBaseline.id, status: latestBaseline.dataQualityStatus };
    }

    // Aggregate overall status
    let hasBlocked = false;
    let hasOperational = false;
    for (const key of Object.keys(result.dimensions)) {
        const dimStatus = (result.dimensions as any)[key].status;
        if (dimStatus === 'blocked') hasBlocked = true;
        if (dimStatus === 'operational_only') hasOperational = true;
    }

    if (hasBlocked) {
        result.status = 'blocked';
    } else if (hasOperational) {
        result.status = 'operational_only';
    } else {
        result.status = 'decision_ready';
    }

    // Only create a certification record if we actually have a cash snapshot
    if (result.cashSnapshotId) {
        await tx.companyDataReadinessCertification.create({
            data: {
                companyId,
                forecastCheckpointId: forecastCheckpointId || null,
                asOfDate,
                status: result.status,
                evidenceJson: JSON.stringify({ ...result.dimensions, cashSnapshotId: result.cashSnapshotId, auditEvidence }),
                blockingReasonsJson: JSON.stringify(result.blockingReasons),
                certifiedBy: 'System Evaluator',
            }
        });
    }

    return result;
}
