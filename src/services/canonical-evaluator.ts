import prisma from "@/db/prisma";

import { verifyBankCoverage } from "@/services/bank-coverage";
import { calculateResidualActuals } from "@/services/attribution";
import { parseResidualForecastSeries } from "@/services/evaluation-types";

export async function evaluateMaturedCheckpoints(companyId?: string) {
    const now = new Date();
    
    // Find checkpoints where at least week 1 might be mature (weekEnd < now)
    const checkpoints = await prisma.forecastCheckpoint.findMany({
        where: {
            ...(companyId ? { companyId } : {}),
            weekEnd: { lte: now }
        },
        include: {
            BaselineSnapshotHistory: true,
            cashSnapshot: true
        }
    });

    for (const cp of checkpoints) {
        if (!cp.BaselineSnapshotHistory) continue;
        const bsh = cp.BaselineSnapshotHistory;

        // Parse M1 and M4 Evidence
        const m1PreAi = parseResidualForecastSeries(bsh.m1PreAiResidualJson);
        const m4PreAi = parseResidualForecastSeries(bsh.m4PreAiResidualJson);
        const m1PostAi = parseResidualForecastSeries(bsh.m1PostAiResidualJson);

        if (!m1PreAi || !m4PreAi || !m1PostAi) {
            throw new Error(`Evaluation failed for Checkpoint ${cp.id}: missing or malformed prediction JSON`);
        }

        for (let horizon = 1; horizon <= 13; horizon++) {
            const hStart = new Date(cp.weekStart);
            hStart.setDate(hStart.getDate() + horizon * 7);
            const hEnd = new Date(hStart);
            hEnd.setDate(hEnd.getDate() + 7);

            if (hEnd > now) continue; // Horizon hasn't matured yet

            // Assess completeness: Does every active account have coverage >= hEnd?
            const coverageDetails = await verifyBankCoverage(cp.companyId, hStart, hEnd);
            
            const accountCompleteness = coverageDetails.isVerified ? "complete" : "unverified";
            const evaluationValidity = coverageDetails.isVerified ? "valid" : "inconclusive";

            // Fetch Bank Transactions for this horizon
            const txs = await prisma.bankTransaction.findMany({
                where: {
                    companyId: cp.companyId,
                    txDate: { gte: hStart, lt: hEnd }
                },
                include: {
                    attributions: true
                }
            });

            // Separate INFLOW and OUTFLOW
            // User requested: "positive inflow amounts and absolute outflow amounts. Never net inflows and outflows."
            const { residualInflow: canonicalActualInflow, residualOutflow: canonicalActualOutflow } = calculateResidualActuals(txs);


            // Inflow - M1 Stage 2 Pre AI
            await saveObservation({
                checkpointId: cp.id,
                companyId: cp.companyId,
                maturedWeekStart: hStart,
                horizonWeeks: horizon,
                direction: "inflow",
                model: "m1",
                stage: "stage2",
                predictionAmount: m1PreAi.inflow[horizon - 1],
                canonicalActual: canonicalActualInflow,
                accountCompleteness,
                evaluationValidity
            });

            // Outflow - M1 Stage 2 Pre AI
            await saveObservation({
                checkpointId: cp.id,
                companyId: cp.companyId,
                maturedWeekStart: hStart,
                horizonWeeks: horizon,
                direction: "outflow",
                model: "m1",
                stage: "stage2",
                predictionAmount: m1PreAi.outflow[horizon - 1],
                canonicalActual: canonicalActualOutflow,
                accountCompleteness,
                evaluationValidity
            });

            // Inflow - M4 Stage 2 Pre AI
            await saveObservation({
                checkpointId: cp.id,
                companyId: cp.companyId,
                maturedWeekStart: hStart,
                horizonWeeks: horizon,
                direction: "inflow",
                model: "m4",
                stage: "stage2",
                predictionAmount: m4PreAi.inflow[horizon - 1],
                canonicalActual: canonicalActualInflow,
                accountCompleteness,
                evaluationValidity
            });
            
            // Outflow - M4 Stage 2 Pre AI
            await saveObservation({
                checkpointId: cp.id,
                companyId: cp.companyId,
                maturedWeekStart: hStart,
                horizonWeeks: horizon,
                direction: "outflow",
                model: "m4",
                stage: "stage2",
                predictionAmount: m4PreAi.outflow[horizon - 1],
                canonicalActual: canonicalActualOutflow,
                accountCompleteness,
                evaluationValidity
            });

            // Inflow - M1 Stage 3 Post AI
            await saveObservation({
                checkpointId: cp.id,
                companyId: cp.companyId,
                maturedWeekStart: hStart,
                horizonWeeks: horizon,
                direction: "inflow",
                model: "m1",
                stage: "stage3",
                predictionAmount: m1PostAi.inflow[horizon - 1],
                canonicalActual: canonicalActualInflow,
                accountCompleteness,
                evaluationValidity
            });

            // Outflow - M1 Stage 3 Post AI
            await saveObservation({
                checkpointId: cp.id,
                companyId: cp.companyId,
                maturedWeekStart: hStart,
                horizonWeeks: horizon,
                direction: "outflow",
                model: "m1",
                stage: "stage3",
                predictionAmount: m1PostAi.outflow[horizon - 1],
                canonicalActual: canonicalActualOutflow,
                accountCompleteness,
                evaluationValidity
            });
        }
    }
}

async function saveObservation(input: {
    checkpointId: string; companyId: string; maturedWeekStart: Date; horizonWeeks: number; 
    direction: string; model: string; stage: string; predictionAmount: number; 
    canonicalActual: number; accountCompleteness: string; evaluationValidity: string;
}) {
    const signedError = input.predictionAmount - input.canonicalActual;
    const absoluteError = Math.abs(signedError);
    let dangerousSide = false;
    if (input.direction === "inflow") {
        dangerousSide = input.predictionAmount > input.canonicalActual;
    } else {
        dangerousSide = input.predictionAmount < input.canonicalActual;
    }

    await prisma.$transaction(async (tx) => {
        // Find existing latest observation
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
            orderBy: { version: 'desc' }
        });

        const nextVersion = existing ? existing.version + 1 : 1;

        if (existing) {
            // Supersede the existing observation
            await tx.forecastEvaluationObservation.update({
                where: { id: existing.id },
                data: {
                    isLatest: false,
                    supersededAt: new Date()
                }
            });
        }

        // Insert new observation
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
                attributionAmbiguity: "clear",
                accountCompleteness: input.accountCompleteness,
                evaluationValidity: input.evaluationValidity,
                version: nextVersion,
                isLatest: true
            }
        });
    });
}
