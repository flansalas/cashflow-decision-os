import { prisma } from "@/db/prisma";

const EVALUATION_LOGIC_VERSION = 1;

export async function runEvaluationForWeek(companyId: string, weekStart: Date) {
    // 1. Fetch the committed checkpoint for this week
    const checkpoint = await prisma.forecastCheckpoint.findFirst({
        where: { companyId, weekStart },
        orderBy: { createdAt: 'desc' },
        include: { componentSnapshots: true }
    });

    if (!checkpoint) {
        return { ok: false, error: "No committed checkpoint found for the specified week." };
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    weekEnd.setUTCHours(23, 59, 59, 999);

    // 2. Fetch Active Attributions for this week
    const activeAttributions = await prisma.actualCashAttribution.findMany({
        where: { companyId, targetWeekStart: weekStart, isActive: true }
    });

    // 3. Mark old evaluations as inactive to preserve history
    await prisma.forecastEvaluationRun.updateMany({
        where: { companyId, weekStart, checkpointId: checkpoint.id, isActive: true },
        data: { isActive: false }
    });

    const previousRun = await prisma.forecastEvaluationRun.findFirst({
        where: { companyId, weekStart, checkpointId: checkpoint.id },
        orderBy: { version: 'desc' }
    });
    const version = previousRun ? previousRun.version + 1 : 1;

    // Track used attributions to avoid double counting
    const unmappedAttributions = [...activeAttributions];
    
    // 3.5 Find any active timing evidence from other weeks that might explain our current week's attributions
    const timingEvidenceLinks = activeAttributions.length > 0 ? await prisma.forecastComponentEvaluationAttribution.findMany({
        where: {
            actualCashAttributionId: { in: activeAttributions.map(a => a.id) },
            evidenceRole: "timing_evidence",
            componentEvaluation: {
                evaluationRun: {
                    isActive: true
                }
            }
        }
    }) : [];
    const timingEvidenceAttributionIds = new Set(timingEvidenceLinks.map(l => l.actualCashAttributionId));

    // Components to create
    const componentEvaluations = [];
    const evaluationAttributions = []; // Array of { attributionId, amount }

    let expectedInflows = 0;
    let actualInflows = 0;
    let expectedOutflows = 0;
    let actualOutflows = 0;

    // 4. Process Snapshots
    for (const snap of checkpoint.componentSnapshots) {
        const expectedCents = Math.round(snap.projectedAmount * 100);
        
        if (snap.direction === "inflow") expectedInflows += expectedCents;
        if (snap.direction === "outflow") expectedOutflows += expectedCents;

        let status = "missed";
        let actualAmountCents = 0;
        const linkedAttributions = [];

        let actualDate = null;
        let daysShifted = null;
        let shiftDirection = null;

        // Match strictly by sourceType and sourceId (No greedy amount matching)
        const matchedIndex = unmappedAttributions.findIndex(a => 
            a.sourceType === snap.sourceType && 
            a.sourceId === snap.sourceId && 
            a.direction === snap.direction
        );

        if (matchedIndex !== -1) {
            // Find ALL matching attributions for this source (Many-to-One/Many-to-Many)
            const matchingAttributions = unmappedAttributions.filter(a => 
                a.sourceType === snap.sourceType && 
                a.sourceId === snap.sourceId && 
                a.direction === snap.direction
            );

            for (const match of matchingAttributions) {
                const appliedCents = Math.round(match.amountAttributed * 100);
                actualAmountCents += appliedCents;
                linkedAttributions.push({ actualCashAttributionId: match.id, amountApplied: match.amountAttributed });
                
                // Remove from unmapped
                const removeIdx = unmappedAttributions.findIndex(a => a.id === match.id);
                if (removeIdx > -1) unmappedAttributions.splice(removeIdx, 1);
            }

            if (actualAmountCents === expectedCents) {
                status = "matched";
            } else {
                status = "partial";
            }
        } else {
            // Timing shift check (Look ahead 1 week, Look behind 1 week)
            if (snap.sourceId) {
                const shiftStart = new Date(weekStart);
                shiftStart.setUTCDate(shiftStart.getUTCDate() - 7);
                const shiftEnd = new Date(weekEnd);
                shiftEnd.setUTCDate(shiftEnd.getUTCDate() + 7);

                const shiftedAttribution = await prisma.actualCashAttribution.findFirst({
                    where: {
                        companyId,
                        sourceType: snap.sourceType,
                        sourceId: snap.sourceId,
                        direction: snap.direction,
                        AND: [
                            { targetWeekStart: { gte: shiftStart, lte: shiftEnd } },
                            { targetWeekStart: { not: weekStart } }
                        ]
                    },
                    include: { bankTransaction: true }
                });

                if (shiftedAttribution) {
                    status = "timing_shift";
                    actualDate = shiftedAttribution.bankTransaction.txDate;
                    const diffTime = actualDate.getTime() - weekStart.getTime();
                    daysShifted = Math.round(diffTime / (1000 * 3600 * 24));
                    shiftDirection = daysShifted > 0 ? "late" : "early";

                    linkedAttributions.push({
                        actualCashAttributionId: shiftedAttribution.id,
                        amountApplied: shiftedAttribution.amountAttributed,
                        evidenceRole: "timing_evidence"
                    });
                }
            }
        }

        if (snap.direction === "inflow") actualInflows += actualAmountCents;
        if (snap.direction === "outflow") actualOutflows += actualAmountCents;

        componentEvaluations.push({
            id: crypto.randomUUID(),
            snapshotId: snap.id,
            expectedAmount: expectedCents / 100,
            actualAmount: actualAmountCents / 100,
            varianceAmount: (actualAmountCents - expectedCents) / 100,
            status,
            sourceType: snap.sourceType,
            sourceId: snap.sourceId,
            confidenceTier: snap.confidenceTier,
            actualDate,
            daysShifted,
            shiftDirection,
            _linkedAttributions: linkedAttributions
        });
    }

    // 5. Process remaining unexpected or unresolved attributions
    for (const unmapped of unmappedAttributions) {
        const actualCents = Math.round(unmapped.amountAttributed * 100);
        
        if (unmapped.direction === "inflow") actualInflows += actualCents;
        if (unmapped.direction === "outflow") actualOutflows += actualCents;

        if (timingEvidenceAttributionIds.has(unmapped.id)) {
            // Already explained by an active timing_evidence link from another week.
            // Do NOT create an unexpected_actual component, but keep the cash in the totals.
            continue;
        }

        const isUnresolved = unmapped.componentCategory.startsWith("unresolved");
        const compEvalId = crypto.randomUUID();

        componentEvaluations.push({
            id: compEvalId,
            snapshotId: null, // No forecast component
            expectedAmount: 0,
            actualAmount: actualCents / 100,
            varianceAmount: actualCents / 100,
            status: isUnresolved ? "unresolved_actual" : "unexpected_actual",
            sourceType: unmapped.sourceType,
            sourceId: unmapped.sourceId,
            confidenceTier: unmapped.confidenceTier,
            _linkedAttributions: [{ actualCashAttributionId: unmapped.id, amountApplied: unmapped.amountAttributed }]
        });
    }

    // 6. Persist Evaluation Run
    const run = await prisma.forecastEvaluationRun.create({
        data: {
            companyId,
            weekStart,
            checkpointId: checkpoint.id,
            evaluationLogicVersion: EVALUATION_LOGIC_VERSION,
            version,
            isActive: true,
            expectedInflows: expectedInflows / 100,
            actualInflows: actualInflows / 100,
            inflowVariance: (actualInflows - expectedInflows) / 100,
            expectedOutflows: expectedOutflows / 100,
            actualOutflows: actualOutflows / 100,
            outflowVariance: (actualOutflows - expectedOutflows) / 100,
            expectedNetCash: (expectedInflows + expectedOutflows) / 100,
            actualNetCash: (actualInflows + actualOutflows) / 100,
            netVariance: ((actualInflows + actualOutflows) - (expectedInflows + expectedOutflows)) / 100,
            components: {
                create: componentEvaluations.map(comp => {
                    const { _linkedAttributions, ...restComp } = comp;
                    return {
                        ...restComp,
                        attributions: {
                            create: _linkedAttributions
                        }
                    };
                })
            }
        }
    });

    return { ok: true, runId: run.id, version: run.version };
}
