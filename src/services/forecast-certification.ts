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
        where: { id: forecastCheckpointId, companyId, sealedAt: { not: null } },
        include: { forecastWeeks: { orderBy: { weekStart: 'asc' } } }
    });

    if (!checkpoint) {
        throw new Error(`Cannot certify: ForecastCheckpoint ${forecastCheckpointId} is either unsealed or does not exist.`);
    }

    // 1. Evaluate current Company Data-Readiness
    const readiness = await evaluateCompanyDataReadiness(companyId, new Date(), checkpoint.cashSnapshotId, forecastCheckpointId, tx);
    
    // Determine if we are forced to cannot_certify due to readiness
    let effectiveStatus = decision.status;
    let readinessId = readiness.certificationId || null;
    
    if (readiness.status !== 'decision_ready') {
        effectiveStatus = 'cannot_certify';
    }

    // 2. Determine buffer amount
    const assumption = await tx.assumption.findFirst({ where: { companyId } });
    const bufferAmount = assumption?.bufferMin || 10000;

    if (!bufferRationale && effectiveStatus === 'certified') {
        effectiveStatus = 'cannot_certify';
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

        const headroom = week.endCashExpected - bufferAmount;
        if (headroom < baseMinBufferHeadroom) {
            baseMinBufferHeadroom = headroom;
        }

        if (headroom < 0 && !baseFirstBreachWeek) {
            baseFirstBreachWeek = week.weekStart;
        }
    }

    if (baseMaxDeficit === null) baseMaxDeficit = 0;

    // 4. Downside Scenario
    const downside = await evaluateDownsideScenario(companyId, forecastCheckpointId, stressInputs, bufferAmount, tx);

    // 5. Evidence payload
    const evidenceJson = JSON.stringify({
        readinessStatus: readiness.status,
        readinessId,
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
            downsideScenarioId: downside.id,
            status: effectiveStatus,
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

            bufferAmount,
            bufferRationale,
            
            readinessCertificationId: readinessId,
            evidenceJson
        }
    });

    return certification;
}
