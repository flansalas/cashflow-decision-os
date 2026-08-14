import { Prisma } from "@prisma/client";
import { assembleForecastData } from "./forecast-assembly";
import { computeForecast } from "./forecast";
import { 
    buildCanonicalPayload, 
    computeCanonicalHash, 
    canonicalJsonSerialize,
    FORECAST_SCHEMA_VERSION,
    HASH_ALGORITHM
} from "./canonical-hash";

/**
 * Creates a sealed ForecastCheckpoint artifact representing the definitive 
 * immutable W1-W13 economic belief state at a specific point in time.
 * 
 * Must be executed INSIDE the rollover transaction, AFTER the rollover state 
 * (new cash snapshot, deductions) has been applied.
 */
export async function createForecastVersion(
    tx: Prisma.TransactionClient,
    companyId: string,
    cashSnapshotId: string,
    appCommitHash: string | null = null,
    snapshotSource: string = "sealed_v1"
) {
    const generatedAt = new Date();
    
    // 1. Fetch current cash snapshot
    const snapshot = await tx.cashSnapshot.findUnique({
        where: { id: cashSnapshotId }
    });
    if (!snapshot) throw new Error("CashSnapshot not found");

    // 2. Fetch baseline snapshot (for preserving baseline state)
    // 3. Assemble inputs using transaction-isolated state
    const assembly = await assembleForecastData(companyId, tx);

    // 4. Compute deterministic 13-week forecast
    const forecastResult = computeForecast(assembly.input);

    // 13-Week Gate
    if (forecastResult.weeks.length !== 13) {
        throw new Error("Forecast MUST have exactly 13 weeks to be sealed.");
    }
    const weekMap = new Set<string>();
    let expectedNextTime = forecastResult.weeks[0].weekStart.getTime();
    for (const w of forecastResult.weeks) {
        if (weekMap.has(w.weekNumber.toString())) throw new Error("Duplicate week detected.");
        weekMap.add(w.weekNumber.toString());
        const diffMs = w.weekStart.getTime() - expectedNextTime;
        // Allow +/- 2 hours for DST boundaries
        if (Math.abs(diffMs) > 2 * 60 * 60 * 1000) {
            throw new Error("Weeks must be strictly contiguous by 7 days.");
        }
        // Advance expectedNextTime by actual difference to stay aligned
        expectedNextTime = w.weekStart.getTime() + (7 * 24 * 60 * 60 * 1000);
    }

    // Component Reconciliation Gate
    for (const w of forecastResult.weeks) {
        const inflowSum = w.breakdown.inflows.reduce((sum: number, c: any) => sum + Math.round(c.amount * 100), 0);
        const outflowSum = w.breakdown.outflows.reduce((sum: number, c: any) => sum + Math.round(c.amount * 100), 0);
        if (inflowSum !== Math.round(w.inflowsExpected * 100)) {
            throw new Error(`Component inflow reconciliation failed for week ${w.weekNumber}: ${inflowSum} !== ${Math.round(w.inflowsExpected * 100)}`);
        }
        if (outflowSum !== Math.round(w.outflowsExpected * 100)) {
            throw new Error(`Component outflow reconciliation failed for week ${w.weekNumber}: ${outflowSum} !== ${Math.round(w.outflowsExpected * 100)}`);
        }
    }

    // 5. Build component mapping for provenance and serialization
    const components: any[] = [];
    
    for (const week of forecastResult.weeks) {
        for (const inflow of week.breakdown.inflows) {
            components.push({
                direction: "inflow",
                sourceType: inflow.sourceType,
                sourceId: inflow.sourceId,
                targetWeekStart: week.weekStart.toISOString(),
                componentCategory: inflow.section || "unknown",
                label: inflow.label || "",
                projectedAmountCents: Math.round(inflow.amount * 100),
                confidenceTier: inflow.confidence || "none",
                sourceAmountAtForecast: inflow.metadata?.sourceAmountAtForecast ?? null,
                sourceDateAtForecast: inflow.metadata?.sourceDateAtForecast ? new Date(inflow.metadata.sourceDateAtForecast) : null,
                sourceStatusAtForecast: inflow.metadata?.sourceStatusAtForecast ?? null,
                overrideId: inflow.metadata?.overrideId ?? null,
                isUserOverridden: inflow.type === "overridden",
                sourceStateJson: canonicalJsonSerialize({
                    ...inflow.metadata,
                    amount: inflow.amount
                }),
                sourceStateHash: computeCanonicalHash(canonicalJsonSerialize({ ...inflow.metadata, amount: inflow.amount }))
            });
        }
        for (const outflow of week.breakdown.outflows) {
            components.push({
                direction: "outflow",
                sourceType: outflow.sourceType,
                sourceId: outflow.sourceId,
                targetWeekStart: week.weekStart.toISOString(),
                componentCategory: outflow.section || "unknown",
                label: outflow.label || "",
                projectedAmountCents: Math.round(outflow.amount * 100),
                confidenceTier: outflow.confidence || "none",
                sourceAmountAtForecast: outflow.metadata?.sourceAmountAtForecast ?? null,
                sourceDateAtForecast: outflow.metadata?.sourceDateAtForecast ? new Date(outflow.metadata.sourceDateAtForecast) : null,
                sourceStatusAtForecast: outflow.metadata?.sourceStatusAtForecast ?? null,
                overrideId: outflow.metadata?.overrideId ?? null,
                isUserOverridden: outflow.type === "overridden",
                sourceStateJson: canonicalJsonSerialize({
                    ...outflow.metadata,
                    amount: outflow.amount
                }),
                sourceStateHash: computeCanonicalHash(canonicalJsonSerialize({ ...outflow.metadata, amount: outflow.amount }))
            });
        }
    }

    // 6. Build Canonical Payload
    const canonicalPayload = buildCanonicalPayload({
        companyId,
        cashSnapshotBalance: snapshot.bankBalance,
        cashSnapshotAsOfDate: snapshot.asOfDate,
        adjustedOpeningCash: forecastResult.weeks[0].startCash,
        assumptions: assembly.input.assumptions,
        baselineReference: { hasBankBaseline: assembly.input.hasBankBaseline, confidence: assembly.input.baselineConfidenceTier },
        forecastWeeks: forecastResult.weeks,
        components,
        appCommitHash
    });

    const canonicalPayloadJson = canonicalJsonSerialize(canonicalPayload);
    const forecastVersionHash = computeCanonicalHash(canonicalPayloadJson);
    if (computeCanonicalHash(canonicalJsonSerialize(canonicalPayload)) !== forecastVersionHash) {
        throw new Error("Reconciliation hash failed");
    }

    // 7. Idempotency Check
    // Concurrency lock: Advisory lock on company string to prevent race condition
    const lockId = String(companyId).split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;

    const existing = await tx.forecastCheckpoint.findFirst({
        where: { companyId, forecastVersionHash, sealedAt: { not: null } }
    });
    if (existing) {
        return existing;
    }
    if (existing) {
        return existing;
    }

    // 8. Seal Checkpoint (create)
    const breakdownJson = JSON.stringify(forecastResult.weeks[0].breakdown);
    const sealedAt = new Date();
    
    // W1-compatible checkpoint header
    const inflowsExpected = forecastResult.weeks[0].inflowsExpected;
    const outflowsExpected = forecastResult.weeks[0].outflowsExpected;
    

    const checkpoint = await tx.forecastCheckpoint.create({
        data: {
            companyId,
            cashSnapshotId,
            snapshotSource,
            forecastVersionHash,
            generatedAt,
            weekStart: forecastResult.weeks[0].weekStart,
            weekEnd: forecastResult.weeks[forecastResult.weeks.length - 1].weekEnd,
            endCashExpected: forecastResult.weeks[0].endCashExpected,
            inflowsExpected,
            outflowsExpected,
            breakdownJson,
            forecastSchemaVersion: FORECAST_SCHEMA_VERSION,
            hashAlgorithm: HASH_ALGORITHM,
            canonicalPayloadJson
        }
    });

    // 9. Create ForecastWeeks
    await tx.forecastWeek.createMany({
        data: forecastResult.weeks.map(w => ({
            companyId,
            forecastVersionHash,
            forecastCheckpointId: checkpoint.id,
            weekStart: w.weekStart,
            weekEnd: w.weekEnd,
            startCash: w.startCash,
            inflowsExpected: w.inflowsExpected,
            outflowsExpected: w.outflowsExpected,
            endCashExpected: w.endCashExpected,
            inflowsBest: w.inflowsBest,
            outflowsBest: w.outflowsBest,
            endCashBest: w.endCashBest,
            inflowsWorst: w.inflowsWorst,
            outflowsWorst: w.outflowsWorst,
            endCashWorst: w.endCashWorst,
            zone: w.zone,
            confidenceScore: w.confidenceScore,
            breakdownJson: JSON.stringify(w.breakdown)
        }))
    });

    // 10. Create Component Snapshots
    if (components.length > 0) {
        await tx.forecastComponentSnapshot.createMany({
            data: components.map(c => ({
                forecastCheckpointId: checkpoint.id,
                targetWeekStart: new Date(c.targetWeekStart),
                direction: c.direction,
                componentCategory: c.componentCategory,
                sourceType: c.sourceType,
                sourceId: c.sourceId,
                projectedAmount: c.projectedAmountCents / 100, // DB stores standard Float amount
                confidenceTier: c.confidenceTier,
                sourceAmountAtForecast: c.sourceAmountAtForecast,
                sourceDateAtForecast: c.sourceDateAtForecast,
                sourceStatusAtForecast: c.sourceStatusAtForecast,
                overrideId: c.overrideId,
                sourceStateJson: c.sourceStateJson,
                sourceStateHash: c.sourceStateHash,
                isUserOverridden: c.isUserOverridden
            }))
        });
    }

    // 11. Create BaselineSnapshotHistory
    // 11. Create BaselineSnapshotHistory
    if (assembly.baseline) {
        const crypto = require('crypto');
        
        // Extract M1 predictions from weeks
        const m1PreAiInflows = forecastResult.weeks.map((w: any) => {
            const c = w.breakdown.inflows.find((i: any) => i.sourceType === 'baseline');
            return c?.metadata?.stage2PreAi || 0;
        });
        const m1PreAiOutflows = forecastResult.weeks.map((w: any) => {
            const c = w.breakdown.outflows.find((o: any) => o.sourceType === 'baseline');
            return c?.metadata?.stage2PreAi || 0;
        });
        const m1PostAiInflows = forecastResult.weeks.map((w: any) => {
            const c = w.breakdown.inflows.find((i: any) => i.sourceType === 'baseline');
            return c?.metadata?.stage3PostAi || c?.metadata?.stage2PreAi || 0;
        });
        const m1PostAiOutflows = forecastResult.weeks.map((w: any) => {
            const c = w.breakdown.outflows.find((o: any) => o.sourceType === 'baseline');
            return c?.metadata?.stage3PostAi || c?.metadata?.stage2PreAi || 0;
        });
        const m1RawInflows = forecastResult.weeks.map((w: any) => {
            const c = w.breakdown.inflows.find((i: any) => i.sourceType === 'baseline');
            return c?.metadata?.stage1Raw || 0;
        });
        const m1RawOutflows = forecastResult.weeks.map((w: any) => {
            const c = w.breakdown.outflows.find((o: any) => o.sourceType === 'baseline');
            return c?.metadata?.stage1Raw || 0;
        });
        
        await tx.baselineSnapshotHistory.create({
            data: {
                id: crypto.randomUUID(),
                forecastCheckpointId: checkpoint.id,
                companyId,
                asOfDate: snapshot.asOfDate,
                
                variableInflowWeekly: assembly.baseline.variableInflowWeekly || 0,
                variableOutflowWeekly: assembly.baseline.variableOutflowWeekly || 0,
                
                explicitInflowJson: JSON.stringify(assembly.baseline.weeklyBuckets || []),
                explicitOutflowJson: JSON.stringify(assembly.baseline.weeklyBuckets || []),
                evidenceStateJson: JSON.stringify(assembly.baseline.weeklyBuckets || []),
                
                promptVersionHash: "assembly-v1",
                modelIdentifier: "assembly-v1",
                
                m1PreAiResidualJson: JSON.stringify({ inflow: m1PreAiInflows, outflow: m1PreAiOutflows }),
                m1PostAiResidualJson: JSON.stringify({ inflow: m1PostAiInflows, outflow: m1PostAiOutflows }),

                m1RawBaselineJson: JSON.stringify({ inflow: m1RawInflows, outflow: m1RawOutflows }),
                
                rawAiResponseJson: "{}",
                reasoningLog: "",
                
                fallbackStatus: "none",
                dataQualityStatus: assembly.baseline.baselineConfidenceTier === "none" || assembly.baseline.baselineConfidenceTier === "low" ? "low_confidence" : "valid",
            }
        });
    }

    // 11.5 Get prior sealed version for lineage
    const priorSealed = await tx.forecastCheckpoint.findFirst({
        where: { companyId, sealedAt: { not: null } },
        orderBy: { sealedAt: 'desc' }
    });
    const priorVersionHash = priorSealed?.forecastVersionHash || null;

    // 12. Create ChangeLog event
    await tx.changeLog.create({
        data: {
            companyId,
            action: "CREATE_FORECAST_VERSION",
            source: "system",
            inputText: `Sealed forecast version ${forecastVersionHash.substring(0, 8)}`,
            forecastVersionHashBefore: priorVersionHash,
            forecastVersionHashAfter: forecastVersionHash,
            diffJson: JSON.stringify({
                forecastVersionHash,
                checkpointId: checkpoint.id,
                generatedAt: generatedAt.toISOString(),
                sealedAt: sealedAt.toISOString()
            })
        }
    });

    // 13. Seal the checkpoint (locking it immutably)
    await tx.forecastCheckpoint.update({
        where: { id: checkpoint.id },
        data: { sealedAt }
    });

    return checkpoint;
}
