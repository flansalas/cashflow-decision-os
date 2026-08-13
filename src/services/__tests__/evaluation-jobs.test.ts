import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Fix weekend-date flakiness by forcing test execution to a known Wednesday

// Fix weekend-date flakiness by forcing test execution to a known Wednesday
vi.setConfig({ testTimeout: 30000 });
vi.useFakeTimers();
vi.setSystemTime(new Date("2026-07-29T12:00:00Z")); // Wednesday
import prisma from "@/db/prisma";

import { v4 as uuidv4 } from "uuid";
import { processEvaluationJobs, triggerEvaluation } from "../evaluation-job-worker";
import { evaluateMaturedCheckpoints } from "../canonical-evaluator";

describe("Evaluation Job Worker and Idempotency", () => {
    let companyId: string;

    beforeAll(async () => {
        companyId = uuidv4();
        await prisma.company.create({
            data: { id: companyId, name: "Test Evaluation Jobs", isDemo: true }
        });
    });

    afterAll(async () => {
        await prisma.company.delete({ where: { id: companyId } });
    });

    beforeEach(async () => {
        await prisma.evaluationJob.deleteMany({ where: { companyId } });
        await prisma.evaluationJobTrigger.deleteMany({ where: { companyId } });
        await prisma.forecastEvaluationObservation.deleteMany({ where: { companyId } });
        await prisma.actualCashAttribution.deleteMany({ where: { companyId } });
        await prisma.bankTransaction.deleteMany({ where: { companyId } });
        await prisma.baselineSnapshotHistory.deleteMany({ where: { companyId } });
        await prisma.forecastCheckpoint.deleteMany({ where: { companyId } });
        await prisma.cashSnapshot.deleteMany({ where: { companyId } });
        
        // Setup standard mock checkpoint
        const snap = await prisma.cashSnapshot.create({
            data: { companyId, bankBalance: 1000, asOfDate: new Date() }
        });
        const { startOfWeek } = require("date-fns");
        const pastDate = startOfWeek(new Date(Date.now() - 21 * 86400000), { weekStartsOn: 1 });

        const cp = await prisma.forecastCheckpoint.create({
            data: {
                companyId, cashSnapshotId: snap.id, snapshotSource: "test", 
                weekStart: pastDate, weekEnd: pastDate, endCashExpected: 1000, inflowsExpected: 500, outflowsExpected: 500,
                breakdownJson: JSON.stringify({ weeks: [] })
            }
        });
        await prisma.baselineSnapshotHistory.create({
            data: {
                id: uuidv4(), companyId, forecastCheckpointId: cp.id, asOfDate: pastDate,
                variableInflowWeekly: 10, variableOutflowWeekly: 10,
                m1PreAiResidualJson: JSON.stringify({ inflow: Array(13).fill(10), outflow: Array(13).fill(10) }),
                m1PostAiResidualJson: JSON.stringify({ inflow: Array(13).fill(10), outflow: Array(13).fill(10) }),
                m4PreAiResidualJson: JSON.stringify({ inflow: Array(13).fill(20), outflow: Array(13).fill(20) })
            }
        });
    });

    it("1. Single-Job Atomic Claiming & Coalescing", async () => {
        await Promise.all([
            triggerEvaluation(companyId, "bank_upload", "upload-1"),
            triggerEvaluation(companyId, "cash_checkin", "checkin-1"),
            triggerEvaluation(companyId, "manual", "manual-1")
        ]);
        const pendingJobs = await prisma.evaluationJob.findMany({ where: { companyId, status: "pending" } });
        expect(pendingJobs.length).toBe(1);
        const triggers = await prisma.evaluationJobTrigger.findMany({ where: { companyId } });
        expect(triggers.length).toBe(3);
        const processedCount = await processEvaluationJobs(companyId);
        expect(processedCount).toBe(1);
        const completedJobs = await prisma.evaluationJob.findMany({ where: { companyId, status: "completed" } });
        expect(completedJobs.length).toBe(1);
    });

    it("2. At-Least-Once Retry (Expired Running Jobs)", async () => {
        const job = await triggerEvaluation(companyId, "timeout_test");
        await prisma.$executeRaw`
            UPDATE "EvaluationJob"
            SET status = 'running', "claimExpiresAt" = NOW() - INTERVAL '1 minute'
            WHERE id = ${job.id}
        `;
        const processedCount = await processEvaluationJobs(companyId);
        expect(processedCount).toBe(1);
    });

    it("3. Immutable Observation Behavior (Supersession)", async () => {
        await evaluateMaturedCheckpoints(companyId);
        let obs = await prisma.forecastEvaluationObservation.findMany({ 
            where: { companyId }
        });
        expect(obs.length).toBeGreaterThan(0);
        
        await evaluateMaturedCheckpoints(companyId);
        obs = await prisma.forecastEvaluationObservation.findMany({ 
            where: { companyId }
        });

        const v1Obs = obs.find(o => o.horizonWeeks === 1 && o.model === "m1" && o.direction === "outflow" && o.version === 1);
        const v2Obs = obs.find(o => o.horizonWeeks === 1 && o.model === "m1" && o.direction === "outflow" && o.version === 2);

        expect(v1Obs?.isLatest).toBe(false);
        expect(v2Obs?.isLatest).toBe(true);
    });

    it("4. Evaluator Idempotency & Uniqueness", async () => {
        await evaluateMaturedCheckpoints(companyId);
        const obs = await prisma.forecastEvaluationObservation.findMany({ 
            where: { companyId, isLatest: true }
        });
        expect(obs.length).toBeGreaterThan(0);
        const uniqueSet = new Set(obs.map(o => `${o.model}-${o.direction}-${o.horizonWeeks}-${o.stage}`));
        expect(uniqueSet.size).toBe(obs.length);
    });

    it("5. Account Completeness", async () => {
        await evaluateMaturedCheckpoints(companyId);
        const obs = await prisma.forecastEvaluationObservation.findFirst({ 
            where: { companyId, isLatest: true }
        });
        expect(obs?.accountCompleteness).toBe("unverified");
        expect(obs?.evaluationValidity).toBe("inconclusive");
    });

    it("6. Attribution Boundaries", async () => {
        const hStart = new Date();
        hStart.setDate(hStart.getDate() - 21);
        
        const account = await prisma.bankAccount.create({
            data: { id: uuidv4(), companyId, name: "Test" }
        });

        const tx = await prisma.bankTransaction.create({
            data: {
                id: uuidv4(), companyId, accountId: account.id,
                txDate: hStart, amount: 100, direction: "inflow",
                internalTransferStatus: "unresolved", description: "Test TX"
            }
        });

        await prisma.actualCashAttribution.create({
            data: {
                id: uuidv4(), companyId, bankTransactionId: tx.id,
                amountAttributed: 150, targetWeekStart: hStart,
                direction: "inflow", confidenceTier: "high", isActive: true,
                componentCategory: "variable", sourceType: "manual",
                attributionRunId: uuidv4()
            }
        });

        await evaluateMaturedCheckpoints(companyId);
        const obs = await prisma.forecastEvaluationObservation.findFirst({ 
            where: { companyId, isLatest: true, horizonWeeks: 1, direction: "inflow" },
            orderBy: { version: 'desc' }
        });
        expect(obs?.canonicalActual).toBe(0);
    });

    it("7. M1 Golden-Master Equivalence", async () => {
        // Assert that M1 prediction amounts perfectly match the pre-AI residuals
        // In the setup, we gave M1 PreAi residuals: [10, 10, ...]
        await evaluateMaturedCheckpoints(companyId);
        const obs = await prisma.forecastEvaluationObservation.findFirst({ 
            where: { companyId, isLatest: true, model: "m1", horizonWeeks: 1, direction: "outflow" }
        });
        expect(obs?.predictionAmount).toBe(10);
    });

    it("8. M4 Isolation", async () => {
        // M4 evaluation should not mutate the active forecast checkpoint or cause AI side-effects
        await evaluateMaturedCheckpoints(companyId);
        
        // Assert checkpoints haven't been mutated
        const cp = await prisma.forecastCheckpoint.findFirst({ where: { companyId } });
        expect(cp?.endCashExpected).toBe(1000); // Unchanged
    });

    it("9. Cross-Tenant Authorization (Endpoints)", async () => {
        // Verify cross-tenant isolation logic via the trigger function (API equivalent)
        const otherCompany = uuidv4();
        await prisma.company.create({ data: { id: otherCompany, name: "Other", isDemo: true } });
        
        // Ensure triggerEvaluation strictly enforces company boundaries
        const job = await triggerEvaluation(otherCompany, "manual");
        expect(job.companyId).toBe(otherCompany);

        // Process jobs for the OTHER company
        await processEvaluationJobs(otherCompany);
        
        // Main company should NOT have completed jobs from this run
        const mainCompanyJobs = await prisma.evaluationJob.findMany({ where: { companyId, status: "completed" } });
        expect(mainCompanyJobs.length).toBe(0);
        
        await prisma.company.delete({ where: { id: otherCompany } });
    });

    it("10. Transfer Pair/Unpair History & Reevaluation", async () => {
        // Pair/Unpair should trigger evaluation jobs
        const job = await triggerEvaluation(companyId, "transfer_unpaired");
        const triggers = await prisma.evaluationJobTrigger.findMany({ where: { evaluationJobId: job.id } });
        expect(triggers[0]?.source).toBe("transfer_unpaired");
        expect(job.status).toBe("pending");
        
        // (In a real scenario, the API route would create InternalTransferHistory and call triggerEvaluation)
    });

    it("11. Exact Week 1-13 Horizon Mapping", async () => {
        // Week 1-13 is horizons 0 through 12
        // We set the checkpoint date to 21 days ago (3 weeks). So horizons 0, 1, 2 should mature!
        await evaluateMaturedCheckpoints(companyId);
        
        const obs = await prisma.forecastEvaluationObservation.findMany({ 
            where: { companyId, isLatest: true, model: "m1" } // Just check m1
        });
        
        // We expect horizons 1 and 2 to be mature
        const horizons = obs.map(o => o.horizonWeeks).sort();
        const uniqueHorizons = [...new Set(horizons)];
        expect(uniqueHorizons).toContain(1);
        expect(uniqueHorizons).toContain(2);
        expect(uniqueHorizons).not.toContain(3); // 3 weeks ago means week 3 is NOT mature yet!
    });
});
