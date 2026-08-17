import prisma from "@/db/prisma";
import type { BaselineSnapshotHistory, ForecastCheckpoint, ForecastWeek } from "@prisma/client";

import { verifyBankCoverage } from "@/services/bank-coverage";
import { calculateResidualActuals } from "@/services/attribution";
import {
    computeCanonicalHash,
    FORECAST_SCHEMA_VERSION,
    HASH_ALGORITHM
} from "@/services/canonical-hash";
import { parseResidualForecastSeries } from "@/services/evaluation-types";

const FORECAST_HORIZON_WEEKS = 13;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CONTIGUITY_TOLERANCE_MS = 2 * 60 * 60 * 1000;

type CanonicalPayloadIdentity = {
    schemaVersion?: number;
    companyId?: string;
    weeks?: Array<{
        weekNumber?: number;
        weekStart?: string;
        weekEnd?: string;
    }>;
};

type EvaluationCheckpoint = ForecastCheckpoint & {
    BaselineSnapshotHistory: BaselineSnapshotHistory | null;
    forecastWeeks: ForecastWeek[];
};

function checkpointError(checkpointId: string, detail: string): Error {
    return new Error(`Evaluation failed for Checkpoint ${checkpointId}: ${detail}`);
}

function assertCanonicalCheckpoint(checkpoint: EvaluationCheckpoint): void {
    if (
        !checkpoint.sealedAt ||
        !checkpoint.forecastVersionHash ||
        !checkpoint.canonicalPayloadJson ||
        checkpoint.forecastSchemaVersion !== FORECAST_SCHEMA_VERSION ||
        checkpoint.hashAlgorithm !== HASH_ALGORITHM
    ) {
        throw checkpointError(checkpoint.id, "checkpoint is not a sealed canonical forecast");
    }

    if (computeCanonicalHash(checkpoint.canonicalPayloadJson) !== checkpoint.forecastVersionHash) {
        throw checkpointError(checkpoint.id, "canonical payload hash does not match the sealed forecast hash");
    }

    let payload: CanonicalPayloadIdentity;
    try {
        payload = JSON.parse(checkpoint.canonicalPayloadJson) as CanonicalPayloadIdentity;
    } catch {
        throw checkpointError(checkpoint.id, "canonical payload JSON is malformed");
    }

    if (payload.companyId !== checkpoint.companyId || payload.schemaVersion !== FORECAST_SCHEMA_VERSION) {
        throw checkpointError(checkpoint.id, "canonical payload identity does not match the checkpoint");
    }

    if (!Array.isArray(payload.weeks) || payload.weeks.length !== FORECAST_HORIZON_WEEKS) {
        throw checkpointError(checkpoint.id, "canonical payload must contain exactly 13 weeks");
    }

    if (!Array.isArray(checkpoint.forecastWeeks) || checkpoint.forecastWeeks.length !== FORECAST_HORIZON_WEEKS) {
        throw checkpointError(checkpoint.id, "persisted forecast must contain exactly 13 weeks");
    }

    for (let index = 0; index < FORECAST_HORIZON_WEEKS; index++) {
        const week = checkpoint.forecastWeeks[index];
        const payloadWeek = payload.weeks[index];
        const expectedHorizon = index + 1;

        if (
            week.companyId !== checkpoint.companyId ||
            week.forecastCheckpointId !== checkpoint.id ||
            week.forecastVersionHash !== checkpoint.forecastVersionHash
        ) {
            throw checkpointError(checkpoint.id, `persisted week ${expectedHorizon} is not bound to the checkpoint identity`);
        }

        if (
            payloadWeek.weekNumber !== expectedHorizon ||
            payloadWeek.weekStart !== week.weekStart.toISOString() ||
            payloadWeek.weekEnd !== week.weekEnd.toISOString()
        ) {
            throw checkpointError(checkpoint.id, `persisted week ${expectedHorizon} does not match the canonical payload`);
        }

        if (index === 0) {
            if (
                checkpoint.weekStart.getTime() !== week.weekStart.getTime() ||
                checkpoint.weekEnd.getTime() !== week.weekEnd.getTime()
            ) {
                throw checkpointError(checkpoint.id, "checkpoint header does not match canonical Week 1");
            }
        } else {
            const priorWeek = checkpoint.forecastWeeks[index - 1];
            const startDifference = week.weekStart.getTime() - priorWeek.weekStart.getTime();
            if (Math.abs(startDifference - WEEK_MS) > CONTIGUITY_TOLERANCE_MS) {
                throw checkpointError(checkpoint.id, `persisted week ${expectedHorizon} is not contiguous`);
            }
        }
    }
}

function seriesIsFinite(series: { inflow: number[]; outflow: number[] }): boolean {
    return [...series.inflow, ...series.outflow].every(Number.isFinite);
}

export async function evaluateMaturedCheckpoints(companyId: string) {
    if (!companyId) throw new Error("Evaluation requires a companyId");

    const now = new Date();
    const checkpoints = await prisma.forecastCheckpoint.findMany({
        where: {
            companyId,
            sealedAt: { not: null },
            forecastVersionHash: { not: null },
            canonicalPayloadJson: { not: null },
            forecastSchemaVersion: FORECAST_SCHEMA_VERSION,
            hashAlgorithm: HASH_ALGORITHM,
            weekStart: { lt: now }
        },
        include: {
            BaselineSnapshotHistory: true,
            forecastWeeks: { orderBy: { weekStart: "asc" } }
        }
    });

    let horizonsEvaluated = 0;
    let observationsWritten = 0;

    for (const cp of checkpoints) {
        assertCanonicalCheckpoint(cp);
        if (!cp.BaselineSnapshotHistory) continue;
        const bsh = cp.BaselineSnapshotHistory;

        // Parse M1 and M4 Evidence
        const m1PreAi = parseResidualForecastSeries(bsh.m1PreAiResidualJson);
        const m4PreAi = bsh.m4PreAiResidualJson ? parseResidualForecastSeries(bsh.m4PreAiResidualJson) : null;
        const m1PostAi = parseResidualForecastSeries(bsh.m1PostAiResidualJson);

        if (
            !m1PreAi ||
            !m1PostAi ||
            !seriesIsFinite(m1PreAi) ||
            !seriesIsFinite(m1PostAi) ||
            (bsh.m4PreAiResidualJson && (!m4PreAi || !seriesIsFinite(m4PreAi)))
        ) {
            throw checkpointError(cp.id, "missing or malformed prediction JSON");
        }

        for (let index = 0; index < cp.forecastWeeks.length; index++) {
            const horizonWeeks = index + 1;
            const forecastWeek = cp.forecastWeeks[index];
            const weekStart = new Date(forecastWeek.weekStart);
            const weekEndExclusive = index < cp.forecastWeeks.length - 1
                ? new Date(cp.forecastWeeks[index + 1].weekStart)
                : new Date(forecastWeek.weekEnd.getTime() + 24 * 60 * 60 * 1000);

            if (weekEndExclusive > now) continue;

            const coverageDetails = await verifyBankCoverage(
                cp.companyId,
                weekStart,
                forecastWeek.weekEnd
            );
            const accountCompleteness = coverageDetails.isVerified ? "complete" : "unverified";
            const evaluationValidity = coverageDetails.isVerified ? "valid" : "inconclusive";

            const txs = await prisma.bankTransaction.findMany({
                where: {
                    companyId: cp.companyId,
                    txDate: { gte: weekStart, lt: weekEndExclusive }
                },
                include: { attributions: true }
            });
            const {
                residualInflow: canonicalActualInflow,
                residualOutflow: canonicalActualOutflow
            } = calculateResidualActuals(txs);

            const observations = [
                { direction: "inflow", model: "m1", stage: "stage2", predictionAmount: m1PreAi.inflow[index], canonicalActual: canonicalActualInflow },
                { direction: "outflow", model: "m1", stage: "stage2", predictionAmount: m1PreAi.outflow[index], canonicalActual: canonicalActualOutflow },
                ...(m4PreAi ? [
                    { direction: "inflow", model: "m4", stage: "stage2", predictionAmount: m4PreAi.inflow[index], canonicalActual: canonicalActualInflow },
                    { direction: "outflow", model: "m4", stage: "stage2", predictionAmount: m4PreAi.outflow[index], canonicalActual: canonicalActualOutflow }
                ] : []),
                { direction: "inflow", model: "m1", stage: "stage3", predictionAmount: m1PostAi.inflow[index], canonicalActual: canonicalActualInflow },
                { direction: "outflow", model: "m1", stage: "stage3", predictionAmount: m1PostAi.outflow[index], canonicalActual: canonicalActualOutflow }
            ];

            for (const observation of observations) {
                await saveObservation({
                    checkpointId: cp.id,
                    companyId: cp.companyId,
                    maturedWeekStart: weekStart,
                    horizonWeeks,
                    ...observation,
                    accountCompleteness,
                    evaluationValidity
                });
                observationsWritten++;
            }
            horizonsEvaluated++;
        }
    }

    return {
        checkpointsExamined: checkpoints.length,
        horizonsEvaluated,
        observationsWritten
    };
}

async function saveObservation(input: {
    checkpointId: string;
    companyId: string;
    maturedWeekStart: Date;
    horizonWeeks: number;
    direction: string;
    model: string;
    stage: string;
    predictionAmount: number;
    canonicalActual: number;
    accountCompleteness: string;
    evaluationValidity: string;
}) {
    const signedError = input.predictionAmount - input.canonicalActual;
    const absoluteError = Math.abs(signedError);
    const dangerousSide = input.direction === "inflow"
        ? input.predictionAmount > input.canonicalActual
        : input.predictionAmount < input.canonicalActual;

    await prisma.$transaction(async (tx) => {
        const existing = await tx.forecastEvaluationObservation.findFirst({
            where: {
                companyId: input.companyId,
                forecastCheckpointId: input.checkpointId,
                maturedWeekStart: input.maturedWeekStart,
                horizonWeeks: input.horizonWeeks,
                model: input.model,
                direction: input.direction,
                stage: input.stage,
                isLatest: true
            },
            orderBy: { version: "desc" }
        });

        const nextVersion = existing ? existing.version + 1 : 1;

        if (existing) {
            await tx.forecastEvaluationObservation.update({
                where: { id: existing.id },
                data: { isLatest: false, supersededAt: new Date() }
            });
        }

        await tx.forecastEvaluationObservation.create({
            data: {
                id: crypto.randomUUID(),
                companyId: input.companyId,
                forecastCheckpointId: input.checkpointId,
                maturedWeekStart: input.maturedWeekStart,
                horizonWeeks: input.horizonWeeks,
                model: input.model,
                direction: input.direction,
                stage: input.stage,
                predictionAmount: input.predictionAmount,
                canonicalActual: input.canonicalActual,
                absoluteError,
                signedError,
                dangerousSide,
                // Package 4A does not yet establish component-attribution clarity.
                // Never label these observations as clear learning evidence by default.
                attributionAmbiguity: "not_assessed",
                accountCompleteness: input.accountCompleteness,
                evaluationValidity: input.evaluationValidity,
                version: nextVersion,
                isLatest: true
            }
        });
    });
}
