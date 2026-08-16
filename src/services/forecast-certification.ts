import { Prisma } from "@prisma/client";
import prismaClient from "@/db/prisma";
import {
    computeCanonicalHash,
    FORECAST_SCHEMA_VERSION,
    HASH_ALGORITHM
} from "./canonical-hash";
import { evaluateCompanyDataReadiness } from "./data-readiness-evaluation";
import {
    assertPersistedScenarioIntegrity,
    evaluateDownsideScenario,
    ScenarioRiskMetrics,
    StressInputs,
    validateStressInputs
} from "./forecast-scenario";

export const PACKAGE_3_CERTIFICATION_SCHEMA_VERSION = 1;

export interface CertificationDecision {
    status: "not_safe" | "certified";
    decidedBy: string;
    rationale?: string;
}

export interface ReviewedRiskAuthority {
    forecastCheckpointId: string;
    forecastVersionHash: string;
    cashSnapshotId: string;
    readinessEvidenceHash: string;
    downsideScenarioId: string;
    downsideScenarioHash: string;
    bufferAssumptionId: string | null;
    bufferAmount: number | null;
}

export interface BaseRiskMetrics {
    minCash: number;
    minCashWeek: Date;
    firstNegativeWeek: Date | null;
    maxDeficit: number;
    bufferHeadroom: number | null;
    firstBreachWeek: Date | null;
}

export interface ForecastRiskReview {
    evaluatedAt: Date;
    checkpoint: {
        id: string;
        forecastVersionHash: string;
        cashSnapshotId: string;
        weekStart: Date;
        weekEnd: Date;
        generatedAt: Date;
        sealedAt: Date;
        forecastSchemaVersion: number;
        hashAlgorithm: string;
    };
    readiness: {
        status: string;
        reasons: string[];
        certificationId: string | null;
        evidenceHash: string;
    };
    buffer: {
        amount: number | null;
        assumptionId: string | null;
        existingRationale: string | null;
        authoritative: boolean;
    };
    stressInputs: ReturnType<typeof validateStressInputs>;
    stressSummary: string[];
    baseMetrics: BaseRiskMetrics;
    downsideMetrics: ScenarioRiskMetrics;
    downsideScenario: {
        id: string;
        scenarioHash: string;
        outsideHorizonAR: Awaited<ReturnType<typeof evaluateDownsideScenario>>["outsideHorizonAR"];
    };
    decisionAuthority: ReviewedRiskAuthority;
    eligibility: {
        status: "eligible" | "cannot_certify";
        canFinalizeDecision: boolean;
        canCertify: boolean;
        prerequisiteFailures: string[];
    };
}

export class ForecastGovernanceError extends Error {
    constructor(
        message: string,
        public readonly httpStatus = 400
    ) {
        super(message);
        this.name = "ForecastGovernanceError";
    }
}

function isFiniteNonNegative(value: number | null | undefined): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function calculateRiskMetrics(
    weeks: Array<{ weekStart: Date; endCashExpected: number }>,
    bufferAmount: number | null
): BaseRiskMetrics {
    let minCash = Number.POSITIVE_INFINITY;
    let minCashWeek = weeks[0].weekStart;
    let firstNegativeWeek: Date | null = null;
    let maxDeficit = 0;
    let bufferHeadroom: number | null = null;
    let firstBreachWeek: Date | null = null;

    for (const week of weeks) {
        if (week.endCashExpected < minCash) {
            minCash = week.endCashExpected;
            minCashWeek = week.weekStart;
        }
        if (week.endCashExpected < 0 && !firstNegativeWeek) {
            firstNegativeWeek = week.weekStart;
        }
        if (week.endCashExpected < 0) {
            maxDeficit = Math.max(maxDeficit, Math.abs(week.endCashExpected));
        }
        if (bufferAmount !== null) {
            const headroom = week.endCashExpected - bufferAmount;
            if (bufferHeadroom === null || headroom < bufferHeadroom) bufferHeadroom = headroom;
            if (headroom < 0 && !firstBreachWeek) firstBreachWeek = week.weekStart;
        }
    }

    return {
        minCash,
        minCashWeek,
        firstNegativeWeek,
        maxDeficit,
        bufferHeadroom,
        firstBreachWeek
    };
}

async function loadValidatedCheckpoint(
    companyId: string,
    forecastCheckpointId: string,
    tx: Prisma.TransactionClient
) {
    const checkpoint = await tx.forecastCheckpoint.findFirst({
        where: { id: forecastCheckpointId, companyId },
        include: { forecastWeeks: { orderBy: { weekStart: "asc" } } }
    });

    if (!checkpoint) {
        throw new ForecastGovernanceError("Forecast checkpoint not found for the authenticated tenant.", 404);
    }
    if (!checkpoint.sealedAt) throw new ForecastGovernanceError("Cannot evaluate: Forecast checkpoint must be sealed.");
    if (!checkpoint.generatedAt) throw new ForecastGovernanceError("Cannot evaluate: Forecast checkpoint is missing generatedAt.");
    if (!checkpoint.forecastVersionHash) throw new ForecastGovernanceError("Cannot evaluate: Forecast checkpoint is missing forecastVersionHash.");
    if (!checkpoint.canonicalPayloadJson) throw new ForecastGovernanceError("Cannot evaluate: Forecast checkpoint is missing canonicalPayloadJson.");
    if (!checkpoint.forecastSchemaVersion) throw new ForecastGovernanceError("Cannot evaluate: Forecast checkpoint is missing forecastSchemaVersion.");
    if (!checkpoint.hashAlgorithm) throw new ForecastGovernanceError("Cannot evaluate: Forecast checkpoint is missing hashAlgorithm.");
    if (checkpoint.forecastSchemaVersion !== FORECAST_SCHEMA_VERSION) {
        throw new ForecastGovernanceError("Cannot evaluate: Forecast checkpoint schema version is unsupported.");
    }
    if (checkpoint.hashAlgorithm !== HASH_ALGORITHM) {
        throw new ForecastGovernanceError("Cannot evaluate: Forecast checkpoint hash algorithm is unsupported.");
    }

    try {
        JSON.parse(checkpoint.canonicalPayloadJson);
    } catch {
        throw new ForecastGovernanceError("Cannot evaluate: Forecast checkpoint canonical payload is malformed.");
    }
    if (computeCanonicalHash(checkpoint.canonicalPayloadJson) !== checkpoint.forecastVersionHash) {
        throw new ForecastGovernanceError("Cannot evaluate: Forecast checkpoint canonical payload does not match forecastVersionHash.");
    }

    const weeks = checkpoint.forecastWeeks;
    if (weeks.length !== 13) {
        throw new ForecastGovernanceError("Cannot evaluate: Forecast checkpoint must have exactly 13 ForecastWeeks.");
    }
    if (weeks[0].weekStart.getTime() !== checkpoint.weekStart.getTime()) {
        throw new ForecastGovernanceError("Cannot evaluate: First week must equal the checkpoint weekStart.");
    }
    for (let index = 1; index < weeks.length; index += 1) {
        const expected = weeks[index - 1].weekStart.getTime() + 7 * 24 * 60 * 60 * 1000;
        if (weeks[index].weekStart.getTime() !== expected) {
            throw new ForecastGovernanceError("Cannot evaluate: Forecast weeks must be contiguous seven-day weeks.");
        }
    }

    const cashSnapshot = await tx.cashSnapshot.findFirst({
        where: { id: checkpoint.cashSnapshotId, companyId },
        select: { id: true }
    });
    if (!cashSnapshot) {
        throw new ForecastGovernanceError("Cannot evaluate: CashSnapshot must belong to the authenticated tenant.");
    }

    return checkpoint as typeof checkpoint & {
        sealedAt: Date;
        generatedAt: Date;
        forecastVersionHash: string;
        canonicalPayloadJson: string;
        forecastSchemaVersion: number;
        hashAlgorithm: string;
    };
}

export async function evaluateForecastRisk(
    companyId: string,
    forecastCheckpointId: string,
    stressInputCandidate: StressInputs,
    tx: Prisma.TransactionClient = prismaClient,
    evaluatedAt: Date = new Date()
): Promise<ForecastRiskReview> {
    const stressInputs = validateStressInputs(stressInputCandidate);
    const checkpoint = await loadValidatedCheckpoint(companyId, forecastCheckpointId, tx);
    const readiness = await evaluateCompanyDataReadiness(
        companyId,
        evaluatedAt,
        checkpoint.cashSnapshotId,
        checkpoint.id,
        tx
    );
    if (!readiness.evidenceHash) {
        throw new ForecastGovernanceError("Readiness evaluation did not produce governed evidence identity.");
    }

    const assumption = await tx.assumption.findFirst({
        where: { companyId },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { id: true, bufferMin: true }
    });
    const bufferAmount = assumption && isFiniteNonNegative(assumption.bufferMin)
        ? assumption.bufferMin
        : null;
    const baseMetrics = calculateRiskMetrics(checkpoint.forecastWeeks, bufferAmount);
    const downside = await evaluateDownsideScenario(
        companyId,
        checkpoint.id,
        stressInputs,
        bufferAmount,
        tx
    );

    const prerequisiteFailures: string[] = [];
    if (readiness.status !== "decision_ready") {
        prerequisiteFailures.push(`Company data readiness is ${readiness.status}.`);
    }
    if (bufferAmount === null) {
        prerequisiteFailures.push("Authoritative live buffer amount is missing or invalid.");
    }

    const decisionAuthority: ReviewedRiskAuthority = {
        forecastCheckpointId: checkpoint.id,
        forecastVersionHash: checkpoint.forecastVersionHash,
        cashSnapshotId: checkpoint.cashSnapshotId,
        readinessEvidenceHash: readiness.evidenceHash,
        downsideScenarioId: downside.id,
        downsideScenarioHash: downside.scenarioHash,
        bufferAssumptionId: assumption?.id || null,
        bufferAmount
    };

    return {
        evaluatedAt,
        checkpoint: {
            id: checkpoint.id,
            forecastVersionHash: checkpoint.forecastVersionHash,
            cashSnapshotId: checkpoint.cashSnapshotId,
            weekStart: checkpoint.weekStart,
            weekEnd: checkpoint.weekEnd,
            generatedAt: checkpoint.generatedAt,
            sealedAt: checkpoint.sealedAt,
            forecastSchemaVersion: checkpoint.forecastSchemaVersion,
            hashAlgorithm: checkpoint.hashAlgorithm
        },
        readiness: {
            status: readiness.status,
            reasons: readiness.blockingReasons,
            certificationId: readiness.certificationId || null,
            evidenceHash: readiness.evidenceHash
        },
        buffer: {
            amount: bufferAmount,
            assumptionId: assumption?.id || null,
            existingRationale: null,
            authoritative: bufferAmount !== null
        },
        stressInputs,
        stressSummary: [
            `Delay explicit AR by ${stressInputs.arDelayWeeks} week(s).`,
            `Reduce residual inflow by ${stressInputs.residualInflowReductionPct}%.`
        ],
        baseMetrics,
        downsideMetrics: downside.metrics,
        downsideScenario: {
            id: downside.id,
            scenarioHash: downside.scenarioHash,
            outsideHorizonAR: downside.outsideHorizonAR
        },
        decisionAuthority,
        eligibility: {
            status: prerequisiteFailures.length === 0 ? "eligible" : "cannot_certify",
            canFinalizeDecision: prerequisiteFailures.length === 0,
            canCertify: prerequisiteFailures.length === 0,
            prerequisiteFailures
        }
    };
}

export async function certifyForecastVersion(
    companyId: string,
    forecastCheckpointId: string,
    decision: CertificationDecision,
    stressInputs: StressInputs,
    bufferRationale?: string,
    reviewedAuthority?: ReviewedRiskAuthority,
    tx: Prisma.TransactionClient = prismaClient
) {
    if (!decision.decidedBy?.trim()) {
        throw new ForecastGovernanceError("Authenticated human decision authority is required.", 401);
    }
    if (decision.status === "not_safe" && !decision.rationale?.trim()) {
        throw new ForecastGovernanceError("A human rationale is required when marking a forecast not safe.");
    }

    const evaluatedAt = new Date();
    const review = await evaluateForecastRisk(
        companyId,
        forecastCheckpointId,
        stressInputs,
        tx,
        evaluatedAt
    );
    if (!reviewedAuthority) {
        throw new ForecastGovernanceError("A governed risk evaluation must be reviewed before a final decision.", 409);
    }
    if (
        reviewedAuthority.forecastCheckpointId !== review.decisionAuthority.forecastCheckpointId ||
        reviewedAuthority.forecastVersionHash !== review.decisionAuthority.forecastVersionHash ||
        reviewedAuthority.cashSnapshotId !== review.decisionAuthority.cashSnapshotId ||
        reviewedAuthority.readinessEvidenceHash !== review.decisionAuthority.readinessEvidenceHash ||
        reviewedAuthority.downsideScenarioId !== review.decisionAuthority.downsideScenarioId ||
        reviewedAuthority.downsideScenarioHash !== review.decisionAuthority.downsideScenarioHash ||
        reviewedAuthority.bufferAssumptionId !== review.decisionAuthority.bufferAssumptionId ||
        reviewedAuthority.bufferAmount !== review.decisionAuthority.bufferAmount
    ) {
        throw new ForecastGovernanceError(
            "The governed forecast, readiness evidence, scenario, cash snapshot, or buffer changed after review. Evaluate again before deciding.",
            409
        );
    }
    const governedBufferRationale = bufferRationale?.trim() || null;
    const missingCertifiedRationale = decision.status === "certified" && !governedBufferRationale;
    const status = !review.eligibility.canFinalizeDecision || missingCertifiedRationale
        ? "cannot_certify"
        : decision.status;

    const evidence = {
        schemaVersion: PACKAGE_3_CERTIFICATION_SCHEMA_VERSION,
        requestedDecision: decision.status,
        finalStatus: status,
        forecastCheckpointId: review.checkpoint.id,
        forecastVersionHash: review.checkpoint.forecastVersionHash,
        cashSnapshotId: review.checkpoint.cashSnapshotId,
        readinessCertificationId: review.readiness.certificationId,
        readinessEvidenceHash: review.readiness.evidenceHash,
        readinessStatus: review.readiness.status,
        readinessReasons: review.readiness.reasons,
        buffer: {
            assumptionId: review.buffer.assumptionId,
            amount: review.buffer.amount,
            rationale: governedBufferRationale,
            authoritative: review.buffer.authoritative
        },
        stressInputs: review.stressInputs,
        downsideScenarioId: review.downsideScenario.id,
        downsideScenarioHash: review.downsideScenario.scenarioHash,
        outsideHorizonAR: review.downsideScenario.outsideHorizonAR,
        baseMetrics: review.baseMetrics,
        downsideMetrics: review.downsideMetrics,
        prerequisiteFailures: [
            ...review.eligibility.prerequisiteFailures,
            ...(missingCertifiedRationale ? ["A governed buffer rationale is required for certification."] : [])
        ]
    };

    return tx.forecastVersionCertification.create({
        data: {
            companyId,
            forecastCheckpointId: review.checkpoint.id,
            forecastVersionHash: review.checkpoint.forecastVersionHash,
            cashSnapshotId: review.checkpoint.cashSnapshotId,
            readinessEvidenceHash: review.readiness.evidenceHash,
            downsideScenarioId: review.downsideScenario.id,
            status,
            schemaVersion: PACKAGE_3_CERTIFICATION_SCHEMA_VERSION,
            evaluatedAt,
            decidedBy: decision.decidedBy,
            decidedAt: evaluatedAt,
            rationale: decision.rationale?.trim() || null,
            baseMinCash: review.baseMetrics.minCash,
            baseMinCashWeek: review.baseMetrics.minCashWeek,
            baseFirstNegativeWeek: review.baseMetrics.firstNegativeWeek,
            baseMaxDeficit: review.baseMetrics.maxDeficit,
            baseBufferHeadroom: review.baseMetrics.bufferHeadroom,
            baseFirstBreachWeek: review.baseMetrics.firstBreachWeek,
            downsideMinCash: review.downsideMetrics.minCash,
            downsideMinCashWeek: review.downsideMetrics.minCashWeek,
            downsideFirstNegativeWeek: review.downsideMetrics.firstNegativeWeek,
            downsideMaxDeficit: review.downsideMetrics.maxDeficit,
            downsideBufferHeadroom: review.downsideMetrics.bufferHeadroom,
            downsideFirstBreachWeek: review.downsideMetrics.firstBreachWeek,
            bufferAmount: review.buffer.amount,
            bufferRationale: governedBufferRationale,
            readinessCertificationId: review.readiness.certificationId,
            evidenceJson: JSON.stringify(evidence)
        }
    });
}

function sameDate(left: Date | null, right: Date | null): boolean {
    return left === null ? right === null : right !== null && left.getTime() === right.getTime();
}

type CertificationWithScenario = Prisma.ForecastVersionCertificationGetPayload<{
    include: { downsideScenario: true };
}>;

interface CertificationEvidenceIdentity {
    finalStatus?: string;
    forecastCheckpointId?: string;
    forecastVersionHash?: string;
    cashSnapshotId?: string;
    readinessEvidenceHash?: string;
    downsideScenarioId?: string;
    downsideScenarioHash?: string;
}

export function assertCertifiedDecisionIntegrity(
    certification: CertificationWithScenario,
    checkpoint: { id: string; companyId: string; forecastVersionHash: string; cashSnapshotId: string; forecastWeeks: Array<{ weekStart: Date; endCashExpected: number }> }
) {
    if (
        certification.status !== "certified" ||
        certification.schemaVersion !== PACKAGE_3_CERTIFICATION_SCHEMA_VERSION ||
        !certification.decidedBy ||
        !certification.decidedAt ||
        certification.companyId !== checkpoint.companyId ||
        certification.forecastCheckpointId !== checkpoint.id ||
        certification.forecastVersionHash !== checkpoint.forecastVersionHash ||
        certification.cashSnapshotId !== checkpoint.cashSnapshotId ||
        !isFiniteNonNegative(certification.bufferAmount) ||
        !certification.bufferRationale?.trim() ||
        !certification.downsideScenario
    ) {
        throw new ForecastGovernanceError("Latest forecast certification failed identity or authority integrity validation.");
    }

    const scenario = certification.downsideScenario;
    if (
        scenario.companyId !== checkpoint.companyId ||
        scenario.forecastCheckpointId !== checkpoint.id ||
        scenario.forecastVersionHash !== checkpoint.forecastVersionHash ||
        scenario.id !== certification.downsideScenarioId
    ) {
        throw new ForecastGovernanceError("Latest forecast certification is not bound to its exact downside scenario.");
    }
    const { document } = assertPersistedScenarioIntegrity(scenario);
    if (document.bufferAmount !== certification.bufferAmount) {
        throw new ForecastGovernanceError("Forecast certification buffer does not match the governed scenario.");
    }

    const base = calculateRiskMetrics(checkpoint.forecastWeeks, certification.bufferAmount);
    if (
        base.minCash !== certification.baseMinCash ||
        !sameDate(base.minCashWeek, certification.baseMinCashWeek) ||
        !sameDate(base.firstNegativeWeek, certification.baseFirstNegativeWeek) ||
        base.maxDeficit !== certification.baseMaxDeficit ||
        base.bufferHeadroom !== certification.baseBufferHeadroom ||
        !sameDate(base.firstBreachWeek, certification.baseFirstBreachWeek) ||
        scenario.minCash !== certification.downsideMinCash ||
        !sameDate(scenario.minCashWeek, certification.downsideMinCashWeek) ||
        !sameDate(scenario.firstNegativeWeek, certification.downsideFirstNegativeWeek) ||
        scenario.maxDeficit !== certification.downsideMaxDeficit ||
        scenario.bufferHeadroom !== certification.downsideBufferHeadroom ||
        !sameDate(scenario.firstBreachWeek, certification.downsideFirstBreachWeek)
    ) {
        throw new ForecastGovernanceError("Forecast certification risk metrics do not reconcile to governed artifacts.");
    }

    const evidence = JSON.parse(certification.evidenceJson) as CertificationEvidenceIdentity;
    if (
        evidence.finalStatus !== certification.status ||
        evidence.forecastCheckpointId !== checkpoint.id ||
        evidence.forecastVersionHash !== checkpoint.forecastVersionHash ||
        evidence.cashSnapshotId !== checkpoint.cashSnapshotId ||
        evidence.readinessEvidenceHash !== certification.readinessEvidenceHash ||
        evidence.downsideScenarioId !== scenario.id ||
        evidence.downsideScenarioHash !== scenario.scenarioHash
    ) {
        throw new ForecastGovernanceError("Forecast certification evidence payload failed integrity validation.");
    }
}
