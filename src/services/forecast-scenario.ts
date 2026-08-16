import { Prisma } from "@prisma/client";
import prismaClient from "@/db/prisma";
import { computeCanonicalHash, canonicalJsonSerialize } from "./canonical-hash";
import { addDays, differenceInCalendarDays } from "date-fns";

export interface StressInputs {
    arDelayWeeks?: number;
    residualInflowReductionPct?: number;
}

export interface ScenarioRiskMetrics {
    minCash: number;
    minCashWeek: Date;
    firstNegativeWeek: Date | null;
    maxDeficit: number | null;
    bufferHeadroom: number;
    firstBreachWeek: Date | null;
}

export interface ScenarioPayloadWeek {
    weekStart: Date;
    startCash: number;
    inflows: number;
    outflows: number;
    endingCash: number;
    stressAdjustments: {
        description: string;
        amountImpact: number;
    }[];
}

export interface ForecastScenarioResult {
    id: string;
    scenarioHash: string;
    payload: ScenarioPayloadWeek[];
    metrics: ScenarioRiskMetrics;
}

export async function evaluateDownsideScenario(
    companyId: string,
    forecastCheckpointId: string,
    stressInputs: StressInputs,
    bufferAmount: number,
    tx: Prisma.TransactionClient = prismaClient
): Promise<ForecastScenarioResult> {
    const checkpoint = await tx.forecastCheckpoint.findUnique({
        where: { id: forecastCheckpointId, companyId, sealedAt: { not: null } },
        include: {
            forecastWeeks: { orderBy: { weekStart: 'asc' } },
            componentSnapshots: true
        }
    });

    if (!checkpoint) {
        throw new Error(`Sealed checkpoint ${forecastCheckpointId} not found for scenario evaluation`);
    }

    const { forecastWeeks, componentSnapshots } = checkpoint;

    // 1. Apply deterministic stresses to components
    // We only care about components that change, to compute delta per week
    const weeklyDeltas = new Map<string, number>(); // weekStart.toISOString() -> net cash flow delta

    for (const week of forecastWeeks) {
        weeklyDeltas.set(week.weekStart.toISOString(), 0);
    }

    // Sort weeks to easily find targets
    const weekStarts = forecastWeeks.map(w => w.weekStart.getTime()).sort((a, b) => a - b);
    const horizonEnd = weekStarts[weekStarts.length - 1] + 7 * 24 * 60 * 60 * 1000;

    const stressAdjustmentsByWeek = new Map<string, { description: string; amountImpact: number }[]>();
    for (const week of forecastWeeks) {
        stressAdjustmentsByWeek.set(week.weekStart.toISOString(), []);
    }

    const addAdjustment = (weekDate: Date, description: string, amount: number) => {
        const key = weekDate.toISOString();
        if (!stressAdjustmentsByWeek.has(key)) return; // Shifted beyond horizon
        stressAdjustmentsByWeek.get(key)!.push({ description, amountImpact: amount });
        weeklyDeltas.set(key, (weeklyDeltas.get(key) || 0) + amount);
    };

    for (const comp of componentSnapshots) {
        // AR Delay
        if (comp.direction === 'inflow' && comp.sourceType === 'invoice' && stressInputs.arDelayWeeks) {
            const originalAmount = comp.projectedAmount;
            if (originalAmount <= 0) continue;

            // Remove from original week
            addAdjustment(comp.targetWeekStart, `AR delayed by ${stressInputs.arDelayWeeks} weeks`, -originalAmount);

            // Add to new week
            const newWeekStart = new Date(comp.targetWeekStart.getTime() + stressInputs.arDelayWeeks * 7 * 24 * 60 * 60 * 1000);
            
            // Find the closest forecast week slot or drop if beyond 13 weeks
            if (newWeekStart.getTime() < horizonEnd) {
                // Determine which exact week bucket it falls into
                const bucketTime = weekStarts.find(ws => ws >= newWeekStart.getTime()) || weekStarts[weekStarts.length - 1];
                addAdjustment(new Date(bucketTime), `AR delayed receipt`, originalAmount);
            }
        }

        // Residual Inflow Reduction
        if (comp.direction === 'inflow' && comp.sourceType === 'baseline' && stressInputs.residualInflowReductionPct) {
            const originalAmount = comp.projectedAmount;
            if (originalAmount <= 0) continue;

            const reduction = originalAmount * (stressInputs.residualInflowReductionPct / 100);
            addAdjustment(comp.targetWeekStart, `Residual inflow reduced by ${stressInputs.residualInflowReductionPct}%`, -reduction);
        }
    }

    // 2. Reconstruct 13-week cash path
    const payload: ScenarioPayloadWeek[] = [];
    let currentCash = forecastWeeks[0]?.startCash || 0;

    let minCash = Infinity;
    let minCashWeek = forecastWeeks[0]?.weekStart || new Date();
    let firstNegativeWeek: Date | null = null;
    let maxDeficit: number | null = null;
    let minBufferHeadroom = Infinity;
    let firstBreachWeek: Date | null = null;

    for (const week of forecastWeeks) {
        const delta = weeklyDeltas.get(week.weekStart.toISOString()) || 0;
        const adjustments = stressAdjustmentsByWeek.get(week.weekStart.toISOString()) || [];
        
        let inflows = week.inflowsExpected;
        let outflows = week.outflowsExpected;

        for (const adj of adjustments) {
            if (adj.amountImpact < 0 && adj.description.includes('delay')) {
                inflows += adj.amountImpact; // reducing inflow
            } else if (adj.amountImpact > 0 && adj.description.includes('delay')) {
                inflows += adj.amountImpact; // adding delayed inflow
            } else if (adj.amountImpact < 0 && adj.description.includes('reduce')) {
                inflows += adj.amountImpact; // reducing inflow
            }
        }

        const endingCash = currentCash + inflows - outflows;

        payload.push({
            weekStart: week.weekStart,
            startCash: currentCash,
            inflows,
            outflows,
            endingCash,
            stressAdjustments: adjustments
        });

        // Metrics
        if (endingCash < minCash) {
            minCash = endingCash;
            minCashWeek = week.weekStart;
        }

        if (endingCash < 0 && !firstNegativeWeek) {
            firstNegativeWeek = week.weekStart;
        }

        if (endingCash < 0) {
            const deficit = Math.abs(endingCash);
            if (maxDeficit === null || deficit > maxDeficit) {
                maxDeficit = deficit;
            }
        }

        const headroom = endingCash - bufferAmount;
        if (headroom < minBufferHeadroom) {
            minBufferHeadroom = headroom;
        }

        if (headroom < 0 && !firstBreachWeek) {
            firstBreachWeek = week.weekStart;
        }

        currentCash = endingCash;
    }

    if (maxDeficit === null) maxDeficit = 0;

    const metrics: ScenarioRiskMetrics = {
        minCash,
        minCashWeek,
        firstNegativeWeek,
        maxDeficit,
        bufferHeadroom: minBufferHeadroom,
        firstBreachWeek
    };

    // 3. Create semantic hash
    const semanticContent = {
        baseCheckpoint: forecastCheckpointId,
        stressInputs,
        payload: payload.map(p => ({
            w: p.weekStart.toISOString(),
            s: p.startCash,
            i: p.inflows,
            o: p.outflows,
            e: p.endingCash
        }))
    };
    const scenarioHash = computeCanonicalHash(canonicalJsonSerialize(semanticContent));

    // 4. Persist or return existing
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
        scenario = await tx.forecastScenario.create({
            data: {
                companyId,
                forecastCheckpointId,
                scenarioHash,
                stressInputsJson: JSON.stringify(stressInputs),
                scenarioPayloadJson: JSON.stringify(payload),
                minCash: metrics.minCash,
                minCashWeek: metrics.minCashWeek,
                firstNegativeWeek: metrics.firstNegativeWeek,
                maxDeficit: metrics.maxDeficit,
                bufferHeadroom: metrics.bufferHeadroom,
                firstBreachWeek: metrics.firstBreachWeek
            }
        });
    }

    return {
        id: scenario.id,
        scenarioHash,
        payload,
        metrics
    };
}
