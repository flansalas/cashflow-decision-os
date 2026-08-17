import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    queryRaw: vi.fn(),
    findUnique: vi.fn(),
    updateJob: vi.fn(),
    evaluateMaturedCheckpoints: vi.fn()
}));

vi.mock("@/db/prisma", () => ({
    default: {
        $queryRaw: mocks.queryRaw,
        evaluationJob: {
            findUnique: mocks.findUnique,
            update: mocks.updateJob
        }
    }
}));
vi.mock("../canonical-evaluator", () => ({
    evaluateMaturedCheckpoints: mocks.evaluateMaturedCheckpoints
}));

import { processEvaluationJobs } from "../evaluation-job-worker";

describe("Evaluation job worker safety", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updateJob.mockResolvedValue({});
    });

    it("claims only the requested tenant and only retries jobs whose delay has elapsed", async () => {
        mocks.queryRaw.mockResolvedValue([]);

        const count = await processEvaluationJobs("tenant-a");

        expect(count).toBe(0);
        expect(mocks.queryRaw).toHaveBeenCalledOnce();
        const [queryParts, boundCompanyId] = mocks.queryRaw.mock.calls[0];
        const sql = Array.from(queryParts as TemplateStringsArray).join("?");
        expect(boundCompanyId).toBe("tenant-a");
        expect(sql).toContain('"companyId" = ?');
        expect(sql).toContain('(status = \'pending\' AND ("retryAfter" IS NULL OR "retryAfter" <= NOW()))');
        expect(sql).toContain('(status = \'running\' AND "claimExpiresAt" < NOW())');
    });

    it("returns a failed attempt to pending with a five-minute delay and releases its claim", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
        mocks.queryRaw
            .mockResolvedValueOnce([{ id: "job-a", companyId: "tenant-a" }])
            .mockResolvedValueOnce([]);
        mocks.evaluateMaturedCheckpoints.mockRejectedValueOnce(new Error("evaluation failed"));
        mocks.findUnique.mockResolvedValue({ id: "job-a", attemptCount: 1 });

        try {
            const count = await processEvaluationJobs("tenant-a");

            expect(count).toBe(1);
            expect(mocks.updateJob).toHaveBeenCalledWith({
                where: { id: "job-a" },
                data: {
                    status: "pending",
                    claimedBy: null,
                    claimExpiresAt: null,
                    failureDetails: "evaluation failed",
                    retryAfter: new Date("2026-08-17T12:05:00.000Z")
                }
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it("clears retry and failure state after a successful evaluation", async () => {
        mocks.queryRaw
            .mockResolvedValueOnce([{ id: "job-a", companyId: "tenant-a" }])
            .mockResolvedValueOnce([]);
        mocks.evaluateMaturedCheckpoints.mockResolvedValue({
            checkpointsExamined: 0,
            horizonsEvaluated: 0,
            observationsWritten: 0
        });

        const count = await processEvaluationJobs("tenant-a");

        expect(count).toBe(1);
        expect(mocks.evaluateMaturedCheckpoints).toHaveBeenCalledWith("tenant-a");
        expect(mocks.updateJob).toHaveBeenCalledWith({
            where: { id: "job-a" },
            data: {
                status: "completed",
                completedAt: expect.any(Date),
                claimedBy: null,
                claimExpiresAt: null,
                retryAfter: null,
                failureDetails: null
            }
        });
    });
});
