import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "../../db/prisma";
import { v4 as uuidv4 } from "uuid";
import { triggerEvaluation, processEvaluationJobs } from "../evaluation-job-worker";

describe("Trigger Coalescing and Preservation", () => {
    let companyId: string;

    beforeAll(async () => {
        companyId = uuidv4();
        await prisma.company.create({
            data: { id: companyId, name: "Test Coalescing", isDemo: true }
        });
    });

    afterAll(async () => {
        await prisma.evaluationJobTrigger.deleteMany({ where: { companyId } });
        await prisma.evaluationJob.deleteMany({ where: { companyId } });
        await prisma.company.delete({ where: { id: companyId } });
    });

    it("should coalesce multiple concurrent triggers into one job and preserve all trigger records", async () => {
        // Fire 5 concurrent triggers
        await Promise.all([
            triggerEvaluation(companyId, "bank_upload", "upload-1"),
            triggerEvaluation(companyId, "cash_checkin", "checkin-1"),
            triggerEvaluation(companyId, "transfer_paired", "transfer-1"),
            triggerEvaluation(companyId, "bank_upload", "upload-2"),
            triggerEvaluation(companyId, "manual_refresh", "refresh-1"),
        ]);

        const jobs = await prisma.evaluationJob.findMany({ where: { companyId, status: "pending" } });
        expect(jobs.length).toBe(1); // One active job exists

        const triggers = await prisma.evaluationJobTrigger.findMany({ 
            where: { evaluationJobId: jobs[0].id }
        });
        expect(triggers.length).toBe(5); // All trigger records are preserved
        
        // Claim and process
        const count = await processEvaluationJobs(companyId);
        expect(count).toBe(1); // One worker claims the job

        const finalJobs = await prisma.evaluationJob.findMany({ where: { companyId } });
        expect(finalJobs[0].status).toBe("completed");
    });
});
