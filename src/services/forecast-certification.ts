import { Prisma } from "@prisma/client";
import prismaClient from "@/db/prisma";
import { evaluateCompanyDataReadiness } from "./data-readiness-evaluation";
import { evaluateDownsideScenario, StressInputs } from "./forecast-scenario";

export interface CertificationDecision {
    status: 'cannot_certify' | 'not_safe' | 'certified';
    decidedBy?: string;
    rationale?: string;
}

export async function certifyForecastVersion(
    companyId: string,
    forecastCheckpointId: string,
    decision: CertificationDecision,
    stressInputs: StressInputs,
    bufferRationale?: string,
    tx: Prisma.TransactionClient = prismaClient
) {
    const checkpoint = await tx.forecastCheckpoint.findUnique({
        where: { id: forecastCheckpointId, companyId },
        include: { forecastWeeks: { orderBy: { weekStart: 'asc' } } }
    });

    // 2. EXACT CHECKPOINT VALIDATION
    if (!checkpoint) {
        throw new Error(`Cannot certify: ForecastCheckpoint ${forecastCheckpointId} does not exist or belongs to another company.`);
    }
    if (!checkpoint.sealedAt) {
        throw new Error("Cannot certify: ForecastCheckpoint must be sealed.");
    }
    if (!checkpoint.forecastVersionHash) {
        throw new Error("Cannot certify: ForecastCheckpoint missing forecastVersionHash.");
    }
    if (!checkpoint.canonicalPayloadJson) {
        throw new Error("Cannot certify: ForecastCheckpoint missing canonicalPayloadJson.");
    }
    if (!checkpoint.forecastSchemaVersion) {
        throw new Error("Cannot certify: ForecastCheckpoint missing forecastSchemaVersion.");
    }
    if (!checkpoint.hashAlgorithm) {
        throw new Error("Cannot certify: ForecastCheckpoint missing hashAlgorithm.");
    }
    if (!checkpoint.generatedAt) {
        throw new Error("Cannot certify: ForecastCheckpoint missing generatedAt.");
    }
    
    const weeks = checkpoint.forecastWeeks || [];
    if (weeks.length !== 13) {
        throw new Error("Cannot certify: ForecastCheckpoint must have exactly 13 ForecastWeeks.");
    }

    if (weeks[0].weekStart.getTime() !== checkpoint.weekStart.getTime()) {
        throw new Error("Cannot certify: First week is not consistent with checkpoint weekStart.");
    }

    for (let i = 1; i < weeks.length; i++) {
        const expectedNext = new Date(weeks[i-1].weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (weeks[i].weekStart.getTime() !== expectedNext.getTime()) {
            throw new Error("Cannot certify: Weeks strictly contiguous by 7 days is required.");
        }
    }

    const cashSnapshot = await tx.cashSnapshot.findUnique({ where: { id: checkpoint.cashSnapshotId } });
    if (!cashSnapshot || cashSnapshot.companyId !== companyId) {
        throw new Error("Cannot certify: CashSnapshot identity must belong to same company.");
    }

    // 1. Evaluate current Company Data-Readiness
    const readiness = await evaluateCompanyDataReadiness(companyId, new Date(), checkpoint.cashSnapshotId, forecastCheckpointId, tx);
    
    // Determine if we are forced to cannot_certify due to readiness
    let effectiveStatus = decision.status;
    let readinessId = readiness.certificationId || null;
    
    // Stale readiness
    if (readiness.status !== 'decision_ready') {
        effectiveStatus = 'cannot_certify';
    }

    // 3. Buffer Governance
    const assumption = await tx.assumption.findFirst({ where: { companyId } });
    const bufferAmount = assumption?.bufferMin;

    if (bufferAmount === undefined || bufferAmount === null) {
        if (effectiveStatus === 'certified') {
            effectiveStatus = 'cannot_certify';
        }
    }

    if (effectiveStatus === 'certified') {
        if (bufferAmount === undefined || bufferAmount === null || !bufferRationale) {
            effectiveStatus = 'cannot_certify';
        }
    }

    // 4. HUMAN DECISION AUTHORITY
    if (effectiveStatus === 'certified') {
        if (!decision.decidedBy) {
            throw new Error("Cannot certify: authenticated human decision authority required.");
        }
    }

    if (decision.decidedBy && effectiveStatus !== 'cannot_certify') {
        // We preserve decidedBy when there's an actual human authority making a deliberate action
    } else {
        // system-generated cannot_certify
        decision.decidedBy = undefined;
    }

    // 3. Base Metrics (from 13 weeks)
    let baseMinCash = Infinity;
    let baseMinCashWeek = checkpoint.forecastWeeks[0]?.weekStart || new Date();
    let baseFirstNegativeWeek: Date | null = null;
    let baseMaxDeficit: number | null = null;
    let baseMinBufferHeadroom = Infinity;
    let baseFirstBreachWeek: Date | null = null;

    for (const week of checkpoint.forecastWeeks) {
        if (week.endCashExpected < baseMinCash) {
            baseMinCash = week.endCashExpected;
            baseMinCashWeek = week.weekStart;
        }

        if (week.endCashExpected < 0 && !baseFirstNegativeWeek) {
            baseFirstNegativeWeek = week.weekStart;
        }

        if (week.endCashExpected < 0) {
            const deficit = Math.abs(week.endCashExpected);
            if (baseMaxDeficit === null || deficit > baseMaxDeficit) {
                baseMaxDeficit = deficit;
            }
        }

        const headroom = week.endCashExpected - (bufferAmount || 0);
        if (headroom < baseMinBufferHeadroom) {
            baseMinBufferHeadroom = headroom;
        }

        if (headroom < 0 && !baseFirstBreachWeek) {
            baseFirstBreachWeek = week.weekStart;
        }
    }

    if (baseMaxDeficit === null) baseMaxDeficit = 0;

    // 4. Downside Scenario
    const downside = await evaluateDownsideScenario(companyId, forecastCheckpointId, stressInputs, bufferAmount || 0, tx);

    // 5. Evidence payload
    const evidenceJson = JSON.stringify({
        readinessStatus: readiness.status,
        readinessId,
        readinessEvidenceHash: readiness.evidenceHash,
        stressInputs,
        baseMetrics: {
            baseMinCash,
            baseMinCashWeek,
            baseFirstNegativeWeek,
            baseMaxDeficit,
            baseMinBufferHeadroom,
            baseFirstBreachWeek
        },
        downsideMetrics: downside.metrics
    });

    // 6. Create Certification
    const certification = await tx.forecastVersionCertification.create({
        data: {
            companyId,
            forecastCheckpointId,
            forecastVersionHash: checkpoint.forecastVersionHash as string,
            cashSnapshotId: checkpoint.cashSnapshotId,
            readinessEvidenceHash: readiness.evidenceHash || "missing",
            downsideScenarioId: downside.id,
            status: effectiveStatus,
            schemaVersion: 1,
            evaluatedAt: new Date(),
            decidedBy: decision.decidedBy,
            decidedAt: decision.decidedBy ? new Date() : null,
            rationale: decision.rationale,

            baseMinCash,
            baseMinCashWeek,
            baseFirstNegativeWeek,
            baseMaxDeficit,
            baseBufferHeadroom: baseMinBufferHeadroom,
            baseFirstBreachWeek,

            downsideMinCash: downside.metrics.minCash,
            downsideMinCashWeek: downside.metrics.minCashWeek,
            downsideFirstNegativeWeek: downside.metrics.firstNegativeWeek,
            downsideMaxDeficit: downside.metrics.maxDeficit,
            downsideBufferHeadroom: downside.metrics.bufferHeadroom,
            downsideFirstBreachWeek: downside.metrics.firstBreachWeek,

            bufferAmount: bufferAmount || 0,
            bufferRationale,
            
            readinessCertificationId: readinessId,
            evidenceJson
        }
    });

    return certification;
}
