import { Prisma } from "@prisma/client";
import prismaClient from "@/db/prisma";
import { computeCanonicalHash, canonicalJsonSerialize } from "./canonical-hash";

export const PACKAGE_3_SCENARIO_SCHEMA_VERSION = 1;
export const PACKAGE_3_HASH_ALGORITHM = "sha256";
export const MAX_AR_DELAY_WEEKS = 13;

export interface StressInputs {
    arDelayWeeks?: number;
    residualInflowReductionPct?: number;
}

export interface NormalizedStressInputs {
    arDelayWeeks: number;
    residualInflowReductionPct: number;
}

export interface ScenarioRiskMetrics {
    minCash: number;
    minCashWeek: Date;
    firstNegativeWeek: Date | null;
    maxDeficit: number;
    bufferHeadroom: number | null;
    firstBreachWeek: Date | null;
}

export interface ScenarioStressAdjustment {
    kind: "ar_delay_removal" | "ar_delay_receipt" | "residual_inflow_reduction";
    description: string;
    amountImpact: number;
    sourceId: string | null;
}

export interface ScenarioPayloadWeek {
    weekStart: Date;
    startCash: number;
    inflows: number;
    outflows: number;
    endingCash: number;
    stressAdjustments: ScenarioStressAdjustment[];
}

export interface OutsideHorizonAREvidence {
    sourceId: string | null;
    originalAmount: number;
    originalWeek: Date;
    delayedTargetDate: Date;
    delayedTargetWeek: number;
    status: "outside_horizon";
}

interface ScenarioPayloadDocument {
    schemaVersion: number;
    forecastCheckpointId: string;
    forecastVersionHash: string;
    bufferAmount: number | null;
    weeks: ScenarioPayloadWeek[];
    outsideHorizonAR: OutsideHorizonAREvidence[];
}

export interface ForecastScenarioResult {
    id: string;
    scenarioHash: string;
    payload: ScenarioPayloadWeek[];
    outsideHorizonAR: OutsideHorizonAREvidence[];
    metrics: ScenarioRiskMetrics;
    stressInputs: NormalizedStressInputs;
}

export class StressInputValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "StressInputValidationError";
    }
}

export function validateStressInputs(input: StressInputs | null | undefined): NormalizedStressInputs {
    const arDelayWeeks = input?.arDelayWeeks ?? 0;
    const residualInflowReductionPct = input?.residualInflowReductionPct ?? 0;

    if (
        typeof arDelayWeeks !== "number" ||
        !Number.isFinite(arDelayWeeks) ||
        !Number.isInteger(arDelayWeeks) ||
        arDelayWeeks < 0 ||
        arDelayWeeks > MAX_AR_DELAY_WEEKS
    ) {
        throw new StressInputValidationError(
            `arDelayWeeks must be a finite integer between 0 and ${MAX_AR_DELAY_WEEKS}.`
        );
    }

    if (
        typeof residualInflowReductionPct !== "number" ||
        !Number.isFinite(residualInflowReductionPct) ||
        residualInflowReductionPct < 0 ||
        residualInflowReductionPct > 100
    ) {
        throw new StressInputValidationError(
            "residualInflowReductionPct must be a finite number between 0 and 100."
        );
    }

    return { arDelayWeeks, residualInflowReductionPct };
}

function iso(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error("Scenario evidence contains an invalid date.");
    }
    return date.toISOString();
}

function scenarioSemanticContent(
    checkpointId: string,
    forecastVersionHash: string,
    stressInputs: NormalizedStressInputs,
    bufferAmount: number | null,
    weeks: ScenarioPayloadWeek[],
    outsideHorizonAR: OutsideHorizonAREvidence[]
) {
    return {
        schemaVersion: PACKAGE_3_SCENARIO_SCHEMA_VERSION,
        hashAlgorithm: PACKAGE_3_HASH_ALGORITHM,
        forecastCheckpointId: checkpointId,
        forecastVersionHash,
        stressInputs,
        bufferAmount,
        weeks: weeks.map(week => ({
            weekStart: iso(week.weekStart),
            startCash: week.startCash,
            inflows: week.inflows,
            outflows: week.outflows,
            endingCash: week.endingCash,
            stressAdjustments: week.stressAdjustments
        })),
        outsideHorizonAR: outsideHorizonAR.map(item => ({
            sourceId: item.sourceId,
            originalAmount: item.originalAmount,
            originalWeek: iso(item.originalWeek),
            delayedTargetDate: iso(item.delayedTargetDate),
            delayedTargetWeek: item.delayedTargetWeek,
            status: item.status
        }))
    };
}

export function computeScenarioHash(
    checkpointId: string,
    forecastVersionHash: string,
    stressInputs: NormalizedStressInputs,
    bufferAmount: number | null,
    weeks: ScenarioPayloadWeek[],
    outsideHorizonAR: OutsideHorizonAREvidence[]
): string {
    return computeCanonicalHash(canonicalJsonSerialize(
        scenarioSemanticContent(
            checkpointId,
            forecastVersionHash,
            stressInputs,
            bufferAmount,
            weeks,
            outsideHorizonAR
        )
    ));
}

export function assertPersistedScenarioIntegrity(scenario: {
    forecastCheckpointId: string;
    forecastVersionHash: string;
    schemaVersion: number;
    hashAlgorithm: string;
    scenarioHash: string;
    stressInputsJson: string;
    scenarioPayloadJson: string;
}) {
    if (
        scenario.schemaVersion !== PACKAGE_3_SCENARIO_SCHEMA_VERSION ||
        scenario.hashAlgorithm !== PACKAGE_3_HASH_ALGORITHM
    ) {
        throw new Error("Forecast scenario schema/hash authority is invalid.");
    }

    const stressInputs = validateStressInputs(JSON.parse(scenario.stressInputsJson));
    const document = JSON.parse(scenario.scenarioPayloadJson) as ScenarioPayloadDocument;
    if (
        document.schemaVersion !== PACKAGE_3_SCENARIO_SCHEMA_VERSION ||
        document.forecastCheckpointId !== scenario.forecastCheckpointId ||
        document.forecastVersionHash !== scenario.forecastVersionHash ||
        !Array.isArray(document.weeks) ||
        document.weeks.length !== 13 ||
        !Array.isArray(document.outsideHorizonAR)
    ) {
        throw new Error("Forecast scenario payload identity is invalid.");
    }

    const expectedHash = computeScenarioHash(
        scenario.forecastCheckpointId,
        scenario.forecastVersionHash,
        stressInputs,
        document.bufferAmount,
        document.weeks,
        document.outsideHorizonAR
    );
    if (expectedHash !== scenario.scenarioHash) {
        throw new Error("Forecast scenario hash integrity check failed.");
    }

    return { stressInputs, document };
}

export async function evaluateDownsideScenario(
    companyId: string,
    forecastCheckpointId: string,
    stressInputCandidate: StressInputs,
    bufferAmount: number | null,
    tx: Prisma.TransactionClient = prismaClient
): Promise<ForecastScenarioResult> {
    const stressInputs = validateStressInputs(stressInputCandidate);
    if (bufferAmount !== null && (!Number.isFinite(bufferAmount) || bufferAmount < 0)) {
        throw new Error("Authoritative buffer amount must be a finite non-negative number.");
    }

    const checkpoint = await tx.forecastCheckpoint.findFirst({
        where: { id: forecastCheckpointId, companyId, sealedAt: { not: null } },
        include: {
            forecastWeeks: { orderBy: { weekStart: "asc" } },
            componentSnapshots: { orderBy: { id: "asc" } }
        }
    });

    if (!checkpoint || !checkpoint.forecastVersionHash) {
        throw new Error(`Sealed checkpoint ${forecastCheckpointId} not found for scenario evaluation.`);
    }
    if (checkpoint.forecastWeeks.length !== 13) {
        throw new Error("Scenario evaluation requires exactly 13 forecast weeks.");
    }

    const { forecastWeeks, componentSnapshots } = checkpoint;
    const weekStarts = forecastWeeks.map(week => week.weekStart.getTime());
    const horizonEnd = weekStarts[weekStarts.length - 1] + 7 * 24 * 60 * 60 * 1000;
    const adjustmentsByWeek = new Map<string, ScenarioStressAdjustment[]>();
    for (const week of forecastWeeks) {
        adjustmentsByWeek.set(week.weekStart.toISOString(), []);
    }

    const addInflowAdjustment = (weekDate: Date, adjustment: ScenarioStressAdjustment) => {
        const adjustments = adjustmentsByWeek.get(weekDate.toISOString());
        if (adjustments) adjustments.push(adjustment);
    };

    const outsideHorizonAR: OutsideHorizonAREvidence[] = [];

    for (const component of componentSnapshots) {
        if (
            component.direction === "inflow" &&
            component.sourceType === "invoice" &&
            stressInputs.arDelayWeeks > 0 &&
            component.projectedAmount > 0
        ) {
            const originalAmount = component.projectedAmount;
            addInflowAdjustment(component.targetWeekStart, {
                kind: "ar_delay_removal",
                description: `AR delayed by ${stressInputs.arDelayWeeks} weeks`,
                amountImpact: -originalAmount,
                sourceId: component.sourceId
            });

            const delayedTargetDate = new Date(
                component.targetWeekStart.getTime() + stressInputs.arDelayWeeks * 7 * 24 * 60 * 60 * 1000
            );
            if (delayedTargetDate.getTime() >= horizonEnd) {
                const originalIndex = weekStarts.indexOf(component.targetWeekStart.getTime());
                outsideHorizonAR.push({
                    sourceId: component.sourceId,
                    originalAmount,
                    originalWeek: component.targetWeekStart,
                    delayedTargetDate,
                    delayedTargetWeek: originalIndex + stressInputs.arDelayWeeks + 1,
                    status: "outside_horizon"
                });
            } else {
                const targetWeekIndex = weekStarts.findIndex((weekStart, index) => {
                    const nextWeekStart = index + 1 < weekStarts.length ? weekStarts[index + 1] : horizonEnd;
                    return delayedTargetDate.getTime() >= weekStart && delayedTargetDate.getTime() < nextWeekStart;
                });
                if (targetWeekIndex >= 0) {
                    addInflowAdjustment(forecastWeeks[targetWeekIndex].weekStart, {
                        kind: "ar_delay_receipt",
                        description: `Delayed AR received in W${targetWeekIndex + 1}`,
                        amountImpact: originalAmount,
                        sourceId: component.sourceId
                    });
                }
            }
        }

        if (
            component.direction === "inflow" &&
            component.sourceType === "baseline" &&
            stressInputs.residualInflowReductionPct > 0 &&
            component.projectedAmount > 0
        ) {
            const reduction = component.projectedAmount * (stressInputs.residualInflowReductionPct / 100);
            addInflowAdjustment(component.targetWeekStart, {
                kind: "residual_inflow_reduction",
                description: `Residual inflow reduced by ${stressInputs.residualInflowReductionPct}%`,
                amountImpact: -reduction,
                sourceId: component.sourceId
            });
        }
    }

    const payload: ScenarioPayloadWeek[] = [];
    let currentCash = forecastWeeks[0].startCash;
    let minCash = Number.POSITIVE_INFINITY;
    let minCashWeek = forecastWeeks[0].weekStart;
    let firstNegativeWeek: Date | null = null;
    let maxDeficit = 0;
    let minBufferHeadroom: number | null = null;
    let firstBreachWeek: Date | null = null;

    for (const week of forecastWeeks) {
        const adjustments = adjustmentsByWeek.get(week.weekStart.toISOString()) || [];
        const inflowAdjustment = adjustments.reduce((total, adjustment) => total + adjustment.amountImpact, 0);
        const inflows = week.inflowsExpected + inflowAdjustment;
        const outflows = week.outflowsExpected;
        const endingCash = currentCash + inflows - outflows;

        payload.push({
            weekStart: week.weekStart,
            startCash: currentCash,
            inflows,
            outflows,
            endingCash,
            stressAdjustments: adjustments
        });

        if (endingCash < minCash) {
            minCash = endingCash;
            minCashWeek = week.weekStart;
        }
        if (endingCash < 0 && !firstNegativeWeek) firstNegativeWeek = week.weekStart;
        if (endingCash < 0) maxDeficit = Math.max(maxDeficit, Math.abs(endingCash));

        if (bufferAmount !== null) {
            const headroom = endingCash - bufferAmount;
            if (minBufferHeadroom === null || headroom < minBufferHeadroom) {
                minBufferHeadroom = headroom;
            }
            if (headroom < 0 && !firstBreachWeek) firstBreachWeek = week.weekStart;
        }

        currentCash = endingCash;
    }

    const metrics: ScenarioRiskMetrics = {
        minCash,
        minCashWeek,
        firstNegativeWeek,
        maxDeficit,
        bufferHeadroom: minBufferHeadroom,
        firstBreachWeek
    };
    const scenarioHash = computeScenarioHash(
        checkpoint.id,
        checkpoint.forecastVersionHash,
        stressInputs,
        bufferAmount,
        payload,
        outsideHorizonAR
    );

    let scenario = await tx.forecastScenario.findUnique({
        where: {
            companyId_forecastCheckpointId_scenarioHash: {
                companyId,
                forecastCheckpointId,
                scenarioHash
            }
        }
    });

    if (!scenario) {
        const payloadDocument: ScenarioPayloadDocument = {
            schemaVersion: PACKAGE_3_SCENARIO_SCHEMA_VERSION,
            forecastCheckpointId: checkpoint.id,
            forecastVersionHash: checkpoint.forecastVersionHash,
            bufferAmount,
            weeks: payload,
            outsideHorizonAR
        };
        scenario = await tx.forecastScenario.create({
            data: {
                companyId,
                forecastCheckpointId,
                forecastVersionHash: checkpoint.forecastVersionHash,
                schemaVersion: PACKAGE_3_SCENARIO_SCHEMA_VERSION,
                hashAlgorithm: PACKAGE_3_HASH_ALGORITHM,
                scenarioHash,
                stressInputsJson: canonicalJsonSerialize(stressInputs),
                scenarioPayloadJson: JSON.stringify(payloadDocument),
                minCash: metrics.minCash,
                minCashWeek: metrics.minCashWeek,
                firstNegativeWeek: metrics.firstNegativeWeek,
                maxDeficit: metrics.maxDeficit,
                bufferHeadroom: metrics.bufferHeadroom,
                firstBreachWeek: metrics.firstBreachWeek
            }
        });
    } else {
        assertPersistedScenarioIntegrity(scenario);
    }

    return {
        id: scenario.id,
        scenarioHash,
        payload,
        outsideHorizonAR,
        metrics,
        stressInputs
    };
}
