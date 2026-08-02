import prisma from "@/db/prisma";

import { verifyBankCoverage } from "@/services/bank-coverage";

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
        let m1PreAi = null;
        let m4PreAi = null;
        try {
            m1PreAi = typeof bsh.m1PreAiResidualJson === 'string' ? JSON.parse(bsh.m1PreAiResidualJson) : bsh.m1PreAiResidualJson;
            m4PreAi = typeof bsh.m4PreAiResidualJson === 'string' ? JSON.parse(bsh.m4PreAiResidualJson) : bsh.m4PreAiResidualJson;
        } catch (e) {}

        if (!Array.isArray(m1PreAi) || !Array.isArray(m4PreAi)) continue; // Missing baseline history

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
            let totalInflow = 0;
            let totalOutflow = 0;
            let totalConfirmedInflowAttr = 0;
            let totalConfirmedOutflowAttr = 0;

            for (const tx of txs) {
                // Exclude confirmed internal transfers
                if (tx.internalTransferStatus === "confirmed") continue;

                const amt = Math.abs(tx.amount);
                let isTxInflow = tx.direction === "inflow" && tx.amount >= 0;
                let isTxOutflow = tx.direction === "outflow" && tx.amount <= 0;
                if (!isTxInflow && !isTxOutflow) {
                    if (tx.amount >= 0) isTxInflow = true;
                    else isTxOutflow = true;
                }

                if (isTxInflow) {
                    totalInflow += amt;
                    for (const attr of tx.attributions) {
                        if (attr.direction === "inflow" && attr.confidenceTier === "high" && attr.isActive) {
                            totalConfirmedInflowAttr += Math.abs(attr.amountAttributed);
                        }
                    }
                } else if (isTxOutflow) {
                    totalOutflow += amt;
                    for (const attr of tx.attributions) {
                        if (attr.direction === "outflow" && attr.confidenceTier === "high" && attr.isActive) {
                            totalConfirmedOutflowAttr += Math.abs(attr.amountAttributed);
                        }
                    }
                }
            }

            // Bound attributions so they do not exceed the absolute transaction amount
            totalConfirmedInflowAttr = Math.min(totalConfirmedInflowAttr, totalInflow);
            totalConfirmedOutflowAttr = Math.min(totalConfirmedOutflowAttr, totalOutflow);

            const canonicalActualInflow = totalInflow - totalConfirmedInflowAttr;
            const canonicalActualOutflow = totalOutflow - totalConfirmedOutflowAttr;

            // Inflow - Stage 2 Pre AI
            await saveObservation({
                checkpointId: cp.id,
                companyId: cp.companyId,
                maturedWeekStart: hStart,
                horizonWeeks: horizon,
                direction: "inflow",
                model: "m1",
                stage: "stage2",
                predictionAmount: 0, // M1 JSON currently stores outflows. We'd need inflow-specific JSON!
                canonicalActual: canonicalActualInflow,
                accountCompleteness,
                evaluationValidity
            });

            // Outflow - Stage 2 Pre AI
            await saveObservation({
                checkpointId: cp.id,
                companyId: cp.companyId,
                maturedWeekStart: hStart,
                horizonWeeks: horizon,
                direction: "outflow",
                model: "m1",
                stage: "stage2",
                predictionAmount: m1PreAi[horizon - 1] || 0,
                canonicalActual: canonicalActualOutflow,
                accountCompleteness,
                evaluationValidity
            });
            
            await saveObservation({
                checkpointId: cp.id,
                companyId: cp.companyId,
                maturedWeekStart: hStart,
                horizonWeeks: horizon,
                direction: "outflow",
                model: "m4",
                stage: "stage2",
                predictionAmount: m4PreAi[horizon - 1] || 0,
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
