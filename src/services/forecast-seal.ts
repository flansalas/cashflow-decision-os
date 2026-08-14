import { Prisma } from "@prisma/client";
import { assembleForecastData } from "./forecast-assembly";
import {
    buildCanonicalPayload,
    computeCanonicalHash,
    canonicalJsonSerialize,
    FORECAST_SCHEMA_VERSION,
    HASH_ALGORITHM
} from "./canonical-hash";

function buildComponentProvenance(assembly: any, comp: any) {
    const isBaseline = comp.sourceType === 'baseline';
    let sourceAmount = null, sourceDate = null, sourceStatus = null;
    let overrides = [];
    let reconciliationLinks = [];
    let deduction = 0;

    if (comp.sourceId) {
        overrides = assembly.overridesByTarget.get(comp.sourceId) || [];
        overrides = [...overrides].sort((a, b) => a.id.localeCompare(b.id));

        const targetLinks = assembly.reconciliationLinks.filter((l: any) => l.targetId === comp.sourceId || l.sourceId === comp.sourceId);
        reconciliationLinks = [...targetLinks].sort((a, b) => a.id.localeCompare(b.id));
        deduction = assembly.deductions.get(comp.sourceId) || 0;

        if (comp.sourceType === "invoice") {
            const raw = assembly.invoicesRaw.find((i:any) => i.id === comp.sourceId);
            if (raw) {
                sourceAmount = raw.amountOpen;
                sourceDate = raw.dueDate;
                sourceStatus = raw.status;
            }
        } else if (comp.sourceType === "bill") {
            const raw = assembly.billsRaw.find((b:any) => b.id === comp.sourceId);
            if (raw) {
                sourceAmount = raw.amountOpen;
                sourceDate = raw.dueDate;
                sourceStatus = raw.status;
            }
        } else if (comp.sourceType === "recurring") {
            const raw = assembly.recurringPatternsRaw.find((r:any) => r.id === comp.sourceId);
            if (raw) {
                sourceAmount = raw.typicalAmount;
                sourceDate = raw.nextExpectedDate;
                sourceStatus = raw.status;
            }
        } else if (comp.sourceType === "manual") {
            const raw = assembly.input?.cashFlowEntries?.find((c:any) => c.sourceId === comp.sourceId);
            if (raw) {
                sourceAmount = raw.amount;
                sourceDate = raw.targetDate;
                sourceStatus = raw.direction;
            }
        }
    }

    const sourceStateObject = {
        semanticSourceIdentity: {
            sourceType: comp.sourceType,
            sourceId: comp.sourceId,
            label: comp.label
        },
        originalState: {
            amount: sourceAmount,
            date: sourceDate,
            status: sourceStatus
        },
        effectiveState: {
            amount: comp.amount,
            effectiveDateAtForecast: comp.metadata?.effectiveDateAtForecast
        },
        managerialState: {
            confidence: comp.confidence
        },
        overrides: overrides.map((o: any) => ({
            id: o.id,
            type: o.type,
            amount: o.amount,
            effectiveDate: o.effectiveDate
        })),
        reconciliations: reconciliationLinks.map((l: any) => ({
            id: l.id,
            sourceType: l.sourceType,
            sourceId: l.sourceId,
            targetType: l.targetType,
            targetId: l.targetId,
            matchedAmount: l.matchedAmount,
            deductFrom: l.deductFrom,
            status: l.status
        })),
        deductionAmount: deduction,
        baselineProvenance: isBaseline ? {
            stage1Raw: comp.metadata?.stage1Raw,
            explicitDeduction: comp.metadata?.explicitDeduction,
            stage2PreAi: comp.metadata?.stage2PreAi,
            aiFactor: comp.metadata?.aiFactor,
            stage3PostAi: comp.metadata?.stage3PostAi,
            finalAmount: comp.amount
        } : undefined
    };

    const sourceStateJson = canonicalJsonSerialize(sourceStateObject);

    let overrideIdToStore = null;
    if (overrides.length === 1) {
        overrideIdToStore = overrides[0].id;
    } else if (overrides.length > 1) {
        // No explicit repository convention yet for primary, fallback to null.
        overrideIdToStore = null;
    }

    return {
        sourceAmountAtForecast: sourceAmount,
        sourceDateAtForecast: sourceDate ? new Date(sourceDate) : null,
        sourceStatusAtForecast: sourceStatus,
        overrideId: overrideIdToStore,
        isUserOverridden: overrides.length > 0 || comp.type === "overridden",
        sourceStateJson,
        sourceStateHash: computeCanonicalHash(sourceStateJson)
    };
}

export async function createForecastVersion(
    tx: Prisma.TransactionClient,
    companyId: string,
    cashSnapshotId: string,
    appCommitHash: string | null = null,
    snapshotSource: string = "server_canonical_v1"
) {
    const generatedAt = new Date();

    // 1. Fetch current cash snapshot
    const snapshot = await tx.cashSnapshot.findUnique({
        where: { id: cashSnapshotId }
    });
    if (!snapshot) throw new Error("CashSnapshot not found");
    if (snapshot.companyId !== companyId) throw new Error("CashSnapshot Company mismatch");

    // 2. Fetch baseline snapshot (for preserving baseline state)
    // 3. Assemble inputs using transaction-isolated state
    const assembly = await assembleForecastData(companyId, tx);

    if (assembly.cashSnapshot.id !== cashSnapshotId) {
        throw new Error("Assembly CashSnapshot ID mismatch");
    }
    if (assembly.cashSnapshot.companyId !== companyId) {
        throw new Error("Assembly CashSnapshot Company mismatch");
    }

    // 4. Determine deterministic 13-week forecast
    const forecastResult = assembly.forecastResult;

    // 13-Week Gate
    if (forecastResult.weeks.length !== 13) {
        throw new Error("Forecast MUST have exactly 13 weeks to be sealed.");
    }
    const weekMap = new Set<string>();
    let expectedNextTime = forecastResult.weeks[0].weekStart.getTime();
    for (let i = 0; i < forecastResult.weeks.length; i++) {
        const w = forecastResult.weeks[i];
        if (w.weekNumber !== i + 1) {
            throw new Error(`Forecast week sequence is invalid. Expected weekNumber ${i + 1}, got ${w.weekNumber}.`);
        }
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
            const prov = buildComponentProvenance(assembly, inflow);
            components.push({
                direction: "inflow",
                sourceType: inflow.sourceType,
                sourceId: inflow.sourceId,
                targetWeekStart: week.weekStart.toISOString(),
                componentCategory: inflow.section || "unknown",
                label: inflow.label || "",
                projectedAmountCents: Math.round(inflow.amount * 100),
                confidenceTier: inflow.confidence || "none",
                ...prov
            });
        }
        for (const outflow of week.breakdown.outflows) {
            const prov = buildComponentProvenance(assembly, outflow);
            components.push({
                direction: "outflow",
                sourceType: outflow.sourceType,
                sourceId: outflow.sourceId,
                targetWeekStart: week.weekStart.toISOString(),
                componentCategory: outflow.section || "unknown",
                label: outflow.label || "",
                projectedAmountCents: Math.round(outflow.amount * 100),
                confidenceTier: outflow.confidence || "none",
                ...prov
            });
        }
    }

    let baselineSourceStateHash: string | null = null;
    let baselineSemanticVersion: string | null = null;
    if (assembly.baseline) {
        const semanticState = {
            hasSufficientHistory: assembly.baseline.hasSufficientHistory,
            baselineConfidenceTier: assembly.baseline.baselineConfidenceTier,
            variableInflowWeekly: assembly.baseline.variableInflowWeekly,
            variableOutflowWeekly: assembly.baseline.variableOutflowWeekly,
            variableInflowBand: assembly.baseline.variableInflowBand,
            variableOutflowBand: assembly.baseline.variableOutflowBand,
            inflowCadence: assembly.baseline.inflowCadence,
            outflowCadence: assembly.baseline.outflowCadence,
            weeklyBuckets: assembly.baseline.weeklyBuckets
        };
        baselineSourceStateHash = computeCanonicalHash(canonicalJsonSerialize(semanticState));
        baselineSemanticVersion = "assembly-v1";
    }

    // 6. Build Canonical Payload
    const canonicalPayload = buildCanonicalPayload({
        companyId,
        cashSnapshotBalance: snapshot.bankBalance,
        cashSnapshotAsOfDate: snapshot.asOfDate,
        adjustedOpeningCash: forecastResult.weeks[0].startCash,
        assumptions: assembly.input.assumptions,
        baselineReference: {
            hasBankBaseline: assembly.input.hasBankBaseline,
            confidence: assembly.input.baselineConfidenceTier,
            baselineSourceStateHash,
            baselineSemanticVersion
        },
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
    const lockId = String(companyId).split("").reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockId})`;

    const existing = await tx.forecastCheckpoint.findFirst({
        where: { companyId, forecastVersionHash, sealedAt: { not: null } }
    });
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
            weekEnd: forecastResult.weeks[0].weekEnd,
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
        data: forecastResult.weeks.map((w: any) => ({
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
    if (assembly.baseline) {
        const crypto = require("crypto");

        // Extract M1 predictions from weeks
        const m1PreAiInflows = forecastResult.weeks.map((w: any) => w.baselineTrace.inflow.stage2PreAi);
        const m1PreAiOutflows = forecastResult.weeks.map((w: any) => w.baselineTrace.outflow.stage2PreAi);

        const m1PostAiInflows = forecastResult.weeks.map((w: any) => w.baselineTrace.inflow.final);
        const m1PostAiOutflows = forecastResult.weeks.map((w: any) => w.baselineTrace.outflow.final);

        const m1RawInflows = forecastResult.weeks.map((w: any) => w.baselineTrace.inflow.stage1Raw);
        const m1RawOutflows = forecastResult.weeks.map((w: any) => w.baselineTrace.outflow.stage1Raw);

        const m1ExplicitDeductionInflows = forecastResult.weeks.map((w: any) => w.baselineTrace.inflow.explicitDeduction);
        const m1ExplicitDeductionOutflows = forecastResult.weeks.map((w: any) => w.baselineTrace.outflow.explicitDeduction);

        const m1AiFactorInflows = forecastResult.weeks.map((w: any) => w.baselineTrace.inflow.aiFactor);
        const m1AiFactorOutflows = forecastResult.weeks.map((w: any) => w.baselineTrace.outflow.aiFactor);

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
                evidenceStateJson: JSON.stringify({
                    bankBalance: snapshot.bankBalance,
                    adjustmentsTotal: assembly.input.adjustmentsTotal
                }),

                promptVersionHash: "assembly-v1",
                modelIdentifier: "assembly-v1",

                m1PreAiResidualJson: JSON.stringify({ inflow: m1PreAiInflows, outflow: m1PreAiOutflows }),
                m1PostAiResidualJson: JSON.stringify({ inflow: m1PostAiInflows, outflow: m1PostAiOutflows }),
                m1RawBaselineJson: JSON.stringify({ inflow: m1RawInflows, outflow: m1RawOutflows }),

                m1ExplicitDeductionJson: JSON.stringify({ inflow: m1ExplicitDeductionInflows, outflow: m1ExplicitDeductionOutflows }),
                m1AiFactorJson: JSON.stringify({ inflow: m1AiFactorInflows, outflow: m1AiFactorOutflows }),

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
        orderBy: { sealedAt: "desc" }
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
                cashSnapshotId,
                schemaVersion: FORECAST_SCHEMA_VERSION,
                hashAlgorithm: HASH_ALGORITHM,
                source: snapshotSource,
                w1Start: forecastResult.weeks[0].weekStart.toISOString(),
                w13End: forecastResult.weeks[forecastResult.weeks.length - 1].weekEnd.toISOString(),
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
