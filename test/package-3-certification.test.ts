import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import prisma from "@/db/prisma";
import {
    computeAPPopulationHash,
    computeARPopulationHash,
    computeRecurringPopulationHash,
    evaluateCompanyDataReadiness
} from "@/services/data-readiness-evaluation";
import {
    certifyForecastVersion,
    evaluateForecastRisk
} from "@/services/forecast-certification";
import {
    evaluateDownsideScenario,
    StressInputs,
    validateStressInputs
} from "@/services/forecast-scenario";
import { approveExecutionPlan } from "@/services/execution-plan-approval";
import {
    canonicalJsonSerialize,
    computeCanonicalHash,
    FORECAST_SCHEMA_VERSION,
    HASH_ALGORITHM
} from "@/services/canonical-hash";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

describe("Package 3 governed forecast certification", { timeout: 300000 }, () => {
    let companyId: string;
    let cashSnapshotId: string;
    let bankAccountId: string;
    let forecastCheckpointId: string;
    let now: Date;

    async function createCheckpoint(options: {
        id?: string;
        sealed?: boolean;
        weekCount?: number;
        weekStart?: Date;
        canonicalPayloadJson?: string;
    } = {}) {
        const id = options.id || randomUUID();
        const canonicalPayloadJson = options.canonicalPayloadJson
            ?? canonicalJsonSerialize({ fixtureCheckpointId: id });
        const hash = computeCanonicalHash(canonicalPayloadJson);
        const weekStart = options.weekStart || now;
        await prisma.forecastCheckpoint.create({
            data: {
                id,
                companyId,
                cashSnapshotId,
                weekStart,
                weekEnd: new Date(weekStart.getTime() + WEEK_MS),
                endCashExpected: 1000,
                inflowsExpected: 0,
                outflowsExpected: 0,
                generatedAt: weekStart,
                forecastVersionHash: hash,
                canonicalPayloadJson,
                forecastSchemaVersion: FORECAST_SCHEMA_VERSION,
                hashAlgorithm: HASH_ALGORITHM,
                sealedAt: null
            }
        });

        await prisma.forecastWeek.createMany({
            data: Array.from({ length: options.weekCount ?? 13 }, (_, index) => ({
                id: randomUUID(),
                forecastCheckpointId: id,
                companyId,
                weekStart: new Date(weekStart.getTime() + index * WEEK_MS),
                weekEnd: new Date(weekStart.getTime() + (index + 1) * WEEK_MS),
                startCash: 1000,
                endCashExpected: 1000,
                inflowsExpected: 0,
                outflowsExpected: 0,
                inflowsBest: 0,
                outflowsBest: 0,
                endCashBest: 1000,
                inflowsWorst: 0,
                outflowsWorst: 0,
                endCashWorst: 1000,
                zone: "green",
                forecastVersionHash: hash
            }))
        });

        if (options.sealed) {
            await prisma.forecastCheckpoint.update({
                where: { id },
                data: { sealedAt: weekStart }
            });
        }

        return id;
    }

    async function sealCheckpoint(id = forecastCheckpointId) {
        await prisma.forecastCheckpoint.update({ where: { id }, data: { sealedAt: now } });
    }

    async function satisfyReadiness(asOfDate = new Date()) {
        const coveredStartDate = new Date(asOfDate.getTime() - WEEK_MS);
        await prisma.dataReadinessAttestation.create({
            data: {
                companyId,
                scopeType: "bank_no_activity",
                scopeKey: bankAccountId,
                status: "active",
                asOfDate,
                certifiedBy: "readiness-owner",
                evidenceJson: JSON.stringify({
                    coveredStartDate: coveredStartDate.toISOString(),
                    coveredEndDate: asOfDate.toISOString()
                }),
                sourceStateHash: "no-activity"
            }
        });

        const [arHash, apHash, recurringHash] = await Promise.all([
            computeARPopulationHash(companyId),
            computeAPPopulationHash(companyId),
            computeRecurringPopulationHash(companyId)
        ]);
        for (const [scopeType, sourceStateHash] of [
            ["ar", arHash],
            ["ap", apHash],
            ["recurring", recurringHash]
        ] as const) {
            await prisma.dataReadinessAttestation.create({
                data: {
                    companyId,
                    scopeType,
                    asOfDate,
                    sourceStateHash,
                    evidenceJson: "{}",
                    certifiedBy: "readiness-owner",
                    status: "active"
                }
            });
        }
    }

    async function addGovernedInvoiceComponent(targetWeekIndex = 0, amount = 1200) {
        const weeks = await prisma.forecastWeek.findMany({
            where: { forecastCheckpointId },
            orderBy: { weekStart: "asc" }
        });
        const week = weeks[targetWeekIndex];
        await prisma.forecastWeek.update({
            where: { id: week.id },
            data: {
                inflowsExpected: amount,
                outflowsExpected: amount,
                endCashExpected: 1000
            }
        });
        await prisma.forecastComponentSnapshot.create({
            data: {
                id: randomUUID(),
                forecastCheckpointId,
                targetWeekStart: week.weekStart,
                direction: "inflow",
                componentCategory: "receivables",
                sourceType: "invoice",
                sourceId: `invoice-${targetWeekIndex}`,
                projectedAmount: amount,
                confidenceTier: "high",
                sourceStateHash: `invoice-state-${targetWeekIndex}`
            }
        });
    }

    async function reviewAuthority(stressInputs: StressInputs = {}) {
        const review = await evaluateForecastRisk(
            companyId,
            forecastCheckpointId,
            stressInputs
        );
        return review.decisionAuthority;
    }

    async function createCertifiedDecision() {
        const stressInputs = { arDelayWeeks: 4, residualInflowReductionPct: 20 };
        const authority = await reviewAuthority(stressInputs);
        return certifyForecastVersion(
            companyId,
            forecastCheckpointId,
            { status: "certified", decidedBy: "clerk-user" },
            stressInputs,
            "The live buffer reflects current operating commitments.",
            authority
        );
    }

    beforeEach(async () => {
        companyId = randomUUID();
        now = new Date();
        await prisma.company.create({ data: { id: companyId, name: "Package 3 Test" } });

        bankAccountId = randomUUID();
        await prisma.bankAccount.create({
            data: { id: bankAccountId, companyId, name: "Operating", isActive: true, role: "operating" }
        });

        cashSnapshotId = randomUUID();
        await prisma.cashSnapshot.create({
            data: { id: cashSnapshotId, companyId, asOfDate: now, bankBalance: 1000 }
        });

        forecastCheckpointId = await createCheckpoint({ id: randomUUID() });
        await prisma.baselineSnapshotHistory.create({
            data: {
                id: randomUUID(),
                companyId,
                asOfDate: now,
                variableInflowWeekly: 0,
                variableOutflowWeekly: 0,
                dataQualityStatus: "valid",
                forecastCheckpointId
            }
        });
        await prisma.assumption.create({
            data: { id: randomUUID(), companyId, bufferMin: 500 }
        });
    }, 60000);

    it("rejects unsealed, foreign, and malformed checkpoints", async () => {
        await expect(evaluateForecastRisk(companyId, forecastCheckpointId, {})).rejects.toThrow(/must be sealed/);

        await sealCheckpoint();
        await expect(evaluateForecastRisk(randomUUID(), forecastCheckpointId, {})).rejects.toThrow(/not found/);

        const malformed = await createCheckpoint({ sealed: true, weekCount: 12 });
        await expect(evaluateForecastRisk(companyId, malformed, {})).rejects.toThrow(/exactly 13/);

        const malformedPayload = await createCheckpoint({ sealed: true, canonicalPayloadJson: "{" });
        await expect(evaluateForecastRisk(companyId, malformedPayload, {})).rejects.toThrow(/canonical payload is malformed/);
    });

    it("keeps unchanged semantic readiness evidence stable across evaluation timestamps", async () => {
        await satisfyReadiness(now);
        const first = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId, forecastCheckpointId);
        const second = await evaluateCompanyDataReadiness(
            companyId,
            new Date(now.getTime() + 5000),
            cashSnapshotId,
            forecastCheckpointId
        );

        expect(first.status).toBe("decision_ready");
        expect(second.status).toBe("decision_ready");
        expect(second.evidenceHash).toBe(first.evidenceHash);
        expect(second.certificationId).not.toBe(first.certificationId);
    });

    it("changes semantic readiness identity when material source authority changes", async () => {
        await satisfyReadiness(now);
        const first = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId, forecastCheckpointId);

        await prisma.receivableInvoice.create({
            data: {
                id: randomUUID(),
                companyId,
                invoiceNo: "INV-NEW",
                customerName: "Changed customer",
                amountOpen: 1000,
                dueDate: now,
                status: "open"
            }
        });
        const second = await evaluateCompanyDataReadiness(companyId, now, cashSnapshotId, forecastCheckpointId);

        expect(second.evidenceHash).not.toBe(first.evidenceHash);
        expect(second.dimensions.accountsReceivable.status).toBe("operational_only");
    });

    it("evaluates an exact decision-ready checkpoint without creating a final decision", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);
        const before = await prisma.forecastVersionCertification.count({ where: { companyId } });

        const review = await evaluateForecastRisk(
            companyId,
            forecastCheckpointId,
            { arDelayWeeks: 4, residualInflowReductionPct: 20 }
        );

        expect(review.readiness.status).toBe("decision_ready");
        expect(review.eligibility.canFinalizeDecision).toBe(true);
        expect(review.buffer.amount).toBe(500);
        expect(await prisma.forecastVersionCertification.count({ where: { companyId } })).toBe(before);
        expect(await prisma.forecastScenario.count({ where: { companyId } })).toBe(1);
    });

    it("normalizes valid stress inputs and rejects unsafe values", () => {
        expect(validateStressInputs({})).toEqual({ arDelayWeeks: 0, residualInflowReductionPct: 0 });
        for (const invalid of [
            { arDelayWeeks: -1 },
            { arDelayWeeks: 1.5 },
            { arDelayWeeks: 14 },
            { arDelayWeeks: Number.NaN },
            { arDelayWeeks: Number.POSITIVE_INFINITY },
            { residualInflowReductionPct: -1 },
            { residualInflowReductionPct: 101 },
            { residualInflowReductionPct: Number.NaN },
            { residualInflowReductionPct: Number.POSITIVE_INFINITY }
        ]) {
            expect(() => validateStressInputs(invalid)).toThrow();
        }
    });

    it("produces deterministic downside results and binds input changes to scenario identity", async () => {
        await addGovernedInvoiceComponent();
        await sealCheckpoint();
        const first = await evaluateDownsideScenario(companyId, forecastCheckpointId, { arDelayWeeks: 1 }, 500);
        const repeated = await evaluateDownsideScenario(companyId, forecastCheckpointId, { arDelayWeeks: 1 }, 500);
        const changed = await evaluateDownsideScenario(companyId, forecastCheckpointId, { arDelayWeeks: 2 }, 500);

        expect(repeated.id).toBe(first.id);
        expect(repeated.scenarioHash).toBe(first.scenarioHash);
        expect(repeated.payload).toEqual(first.payload);
        expect(changed.scenarioHash).not.toBe(first.scenarioHash);
    });

    it("does not mutate the sealed checkpoint and reconciles risk metrics to the 13-week path", async () => {
        await addGovernedInvoiceComponent();
        await sealCheckpoint();
        const before = await prisma.forecastCheckpoint.findUnique({
            where: { id: forecastCheckpointId },
            include: { forecastWeeks: { orderBy: { weekStart: "asc" } } }
        });

        const scenario = await evaluateDownsideScenario(companyId, forecastCheckpointId, { arDelayWeeks: 1 }, 500);
        const after = await prisma.forecastCheckpoint.findUnique({
            where: { id: forecastCheckpointId },
            include: { forecastWeeks: { orderBy: { weekStart: "asc" } } }
        });
        const endingValues = scenario.payload.map(week => week.endingCash);

        expect(after).toEqual(before);
        expect(scenario.payload).toHaveLength(13);
        expect(scenario.metrics.minCash).toBe(Math.min(...endingValues));
        expect(scenario.metrics.firstNegativeWeek).toEqual(now);
        expect(scenario.metrics.maxDeficit).toBe(200);
        expect(scenario.metrics.bufferHeadroom).toBe(-700);
        expect(scenario.metrics.firstBreachWeek).toEqual(now);
    });

    it("removes AR delayed beyond W13 and persists explicit outside-horizon evidence", async () => {
        await addGovernedInvoiceComponent(11, 1200);
        await sealCheckpoint();
        const scenario = await evaluateDownsideScenario(companyId, forecastCheckpointId, { arDelayWeeks: 4 }, 500);
        const persisted = await prisma.forecastScenario.findUniqueOrThrow({ where: { id: scenario.id } });
        const document = JSON.parse(persisted.scenarioPayloadJson);

        expect(scenario.payload).toHaveLength(13);
        expect(scenario.payload[11].stressAdjustments).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "ar_delay_removal", amountImpact: -1200 })
        ]));
        expect(scenario.payload.flatMap(week => week.stressAdjustments)).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: "ar_delay_receipt", sourceId: "invoice-11" })
        ]));
        expect(document.outsideHorizonAR).toEqual([
            expect.objectContaining({
                sourceId: "invoice-11",
                originalAmount: 1200,
                originalWeek: new Date(now.getTime() + 11 * WEEK_MS).toISOString(),
                delayedTargetDate: new Date(now.getTime() + 15 * WEEK_MS).toISOString(),
                delayedTargetWeek: 16,
                status: "outside_horizon"
            })
        ]);
    });

    it("treats missing authoritative buffer as cannot_certify rather than not_safe", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);
        await prisma.assumption.deleteMany({ where: { companyId } });

        const review = await evaluateForecastRisk(companyId, forecastCheckpointId, {});
        expect(review.buffer.amount).toBeNull();
        expect(review.eligibility.status).toBe("cannot_certify");

        const certification = await certifyForecastVersion(
            companyId,
            forecastCheckpointId,
            { status: "not_safe", decidedBy: "clerk-user", rationale: "Risk review attempted." },
            {},
            undefined,
            review.decisionAuthority
        );
        expect(certification.status).toBe("cannot_certify");
        expect(certification.bufferAmount).toBeNull();
    });

    it("requires authenticated human authority and governed buffer rationale for certification", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);

        await expect(certifyForecastVersion(
            companyId,
            forecastCheckpointId,
            { status: "certified", decidedBy: "" },
            {}
        )).rejects.toThrow(/Authenticated human/);

        const missingRationale = await certifyForecastVersion(
            companyId,
            forecastCheckpointId,
            { status: "certified", decidedBy: "clerk-user" },
            {},
            undefined,
            await reviewAuthority()
        );
        expect(missingRationale.status).toBe("cannot_certify");

        const certified = await createCertifiedDecision();
        expect(certified.status).toBe("certified");
        expect(certified.decidedBy).toBe("clerk-user");
        expect(certified.bufferAmount).toBe(500);
        expect(certified.bufferRationale).toMatch(/live buffer/);
    });

    it("binds certification to exact checkpoint, hash, cash snapshot, readiness, and scenario", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);
        const certification = await createCertifiedDecision();
        const evidence = JSON.parse(certification.evidenceJson);

        expect(certification.forecastCheckpointId).toBe(forecastCheckpointId);
        expect(certification.forecastVersionHash).toMatch(/^[a-f0-9]{64}$/);
        expect(certification.cashSnapshotId).toBe(cashSnapshotId);
        expect(certification.readinessEvidenceHash).toBeTruthy();
        expect(certification.downsideScenarioId).toBeTruthy();
        expect(evidence.downsideScenarioId).toBe(certification.downsideScenarioId);
        expect(evidence.readinessEvidenceHash).toBe(certification.readinessEvidenceHash);
    });

    it("rejects a final decision if governed authority changes after human review", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);
        const reviewed = await reviewAuthority();
        const before = await prisma.forecastVersionCertification.count({ where: { companyId } });

        await prisma.receivableInvoice.create({
            data: {
                id: randomUUID(),
                companyId,
                invoiceNo: "INV-AFTER-REVIEW",
                customerName: "Changed after review",
                amountOpen: 500,
                dueDate: now,
                status: "open"
            }
        });

        await expect(certifyForecastVersion(
            companyId,
            forecastCheckpointId,
            { status: "certified", decidedBy: "clerk-user" },
            {},
            "Reviewed buffer rationale.",
            reviewed
        )).rejects.toThrow(/changed after review/);
        expect(await prisma.forecastVersionCertification.count({ where: { companyId } })).toBe(before);
    });

    it("records operational-only evidence as cannot_certify, never certified", async () => {
        await sealCheckpoint();
        const review = await evaluateForecastRisk(companyId, forecastCheckpointId, {});
        expect(review.readiness.status).toBe("operational_only");

        const certification = await certifyForecastVersion(
            companyId,
            forecastCheckpointId,
            { status: "certified", decidedBy: "clerk-user" },
            {},
            "Reviewed buffer rationale.",
            review.decisionAuthority
        );
        expect(certification.status).toBe("cannot_certify");
    });

    it("prevents checkpoint A certification from authorizing checkpoint B", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);
        await createCertifiedDecision();
        const checkpointB = await createCheckpoint({ sealed: true });

        await expect(approveExecutionPlan({
            companyId,
            weekStart: now.toISOString(),
            forecastCheckpointId: checkpointB,
            actions: []
        })).rejects.toThrow(/Certification is absent/);
    });

    it("rejects approval without a certification and after readiness evidence becomes stale", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);
        const planRequest = {
            companyId,
            weekStart: now.toISOString(),
            forecastCheckpointId,
            actions: []
        };
        await expect(approveExecutionPlan(planRequest)).rejects.toThrow(/Certification is absent/);

        await createCertifiedDecision();
        await prisma.receivableInvoice.create({
            data: {
                id: randomUUID(),
                companyId,
                customerName: "New source state",
                invoiceNo: "INV-STALE",
                amountOpen: 200,
                dueDate: now,
                status: "open"
            }
        });
        const newARHash = await computeARPopulationHash(companyId);
        await prisma.dataReadinessAttestation.create({
            data: {
                companyId,
                scopeType: "ar",
                asOfDate: new Date(),
                sourceStateHash: newARHash,
                evidenceJson: "{}",
                certifiedBy: "readiness-owner",
                status: "active"
            }
        });

        await expect(approveExecutionPlan(planRequest)).rejects.toThrow(/readiness evidence hash has changed/);
    });

    it("lets the latest not_safe decision block an earlier certification", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);
        const planRequest = {
            companyId,
            weekStart: now.toISOString(),
            forecastCheckpointId,
            actions: []
        };

        await createCertifiedDecision();
        await certifyForecastVersion(
            companyId,
            forecastCheckpointId,
            { status: "not_safe", decidedBy: "clerk-user", rationale: "Downside is unacceptable." },
            { arDelayWeeks: 4, residualInflowReductionPct: 20 },
            undefined,
            await reviewAuthority({ arDelayWeeks: 4, residualInflowReductionPct: 20 })
        );
        await expect(approveExecutionPlan(planRequest)).rejects.toThrow(/Latest governing.*not_safe/);
    });

    it("lets the latest cannot_certify decision block an earlier certification", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);
        const planRequest = {
            companyId,
            weekStart: now.toISOString(),
            forecastCheckpointId,
            actions: []
        };

        await createCertifiedDecision();
        await prisma.assumption.deleteMany({ where: { companyId } });
        const recurringHashWithoutAssumption = await computeRecurringPopulationHash(companyId);
        await prisma.dataReadinessAttestation.create({
            data: {
                companyId,
                scopeType: "recurring",
                asOfDate: new Date(),
                sourceStateHash: recurringHashWithoutAssumption,
                evidenceJson: "{}",
                certifiedBy: "readiness-owner",
                status: "active"
            }
        });
        const cannotReview = await evaluateForecastRisk(companyId, forecastCheckpointId, {});
        const cannotCertify = await certifyForecastVersion(
            companyId,
            forecastCheckpointId,
            { status: "not_safe", decidedBy: "clerk-user", rationale: "Required buffer authority is absent." },
            {},
            undefined,
            cannotReview.decisionAuthority
        );
        expect(cannotCertify.status).toBe("cannot_certify");
        await expect(approveExecutionPlan(planRequest)).rejects.toThrow(/Latest governing.*cannot_certify/);
    });

    it("lets a newer certified decision restore approval after a blocking decision", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);
        const planRequest = {
            companyId,
            weekStart: now.toISOString(),
            forecastCheckpointId,
            actions: []
        };

        await certifyForecastVersion(
            companyId,
            forecastCheckpointId,
            { status: "not_safe", decidedBy: "clerk-user", rationale: "Downside is unacceptable." },
            { arDelayWeeks: 4, residualInflowReductionPct: 20 },
            undefined,
            await reviewAuthority({ arDelayWeeks: 4, residualInflowReductionPct: 20 })
        );
        await createCertifiedDecision();
        const plan = await approveExecutionPlan(planRequest);
        expect(plan.status).toBe("approved");
        expect(plan.forecastCheckpointId).toBe(forecastCheckpointId);
    });

    it("enforces database immutability for scenarios and finalized certifications", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);
        const scenario = await evaluateDownsideScenario(companyId, forecastCheckpointId, {}, 500);
        const certification = await createCertifiedDecision();

        await expect(prisma.forecastScenario.update({
            where: { id: scenario.id },
            data: { minCash: 999999 }
        })).rejects.toThrow();
        await expect(prisma.forecastScenario.delete({ where: { id: scenario.id } })).rejects.toThrow();
        await expect(prisma.forecastVersionCertification.update({
            where: { id: certification.id },
            data: { baseMinCash: 999999 }
        })).rejects.toThrow();
        await expect(prisma.forecastVersionCertification.delete({ where: { id: certification.id } })).rejects.toThrow();
    });

    it("rejects tenant B reads and writes against tenant A governed artifacts", async () => {
        await sealCheckpoint();
        await satisfyReadiness(now);
        const tenantB = randomUUID();
        await prisma.company.create({ data: { id: tenantB, name: "Tenant B" } });

        await expect(evaluateForecastRisk(tenantB, forecastCheckpointId, {})).rejects.toThrow(/not found/);
        await expect(certifyForecastVersion(
            tenantB,
            forecastCheckpointId,
            { status: "certified", decidedBy: "tenant-b-user" },
            {},
            "Tenant B rationale"
        )).rejects.toThrow(/not found/);
        expect(await prisma.forecastVersionCertification.count({ where: { companyId: tenantB } })).toBe(0);
        expect(await prisma.forecastScenario.count({ where: { companyId: tenantB } })).toBe(0);
    });
});
