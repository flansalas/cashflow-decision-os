import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    createChangeLog: vi.fn(),
    evaluateMaturedCheckpoints: vi.fn()
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ resolveTenant: vi.fn() }));
vi.mock("@/db/prisma", () => ({
    default: {
        changeLog: { create: mocks.createChangeLog }
    }
}));
vi.mock("@/services/canonical-evaluator", () => ({
    evaluateMaturedCheckpoints: mocks.evaluateMaturedCheckpoints
}));

import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import { POST } from "@/app/api/audit/evaluate-horizons/route";

function post(body: object): NextRequest {
    return new NextRequest("http://localhost/api/audit/evaluate-horizons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

describe("Package 4 canonical evaluator tenant controls", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(auth).mockResolvedValue({ userId: "user-a" } as Awaited<ReturnType<typeof auth>>);
        vi.mocked(resolveTenant).mockResolvedValue("tenant-a");
        mocks.evaluateMaturedCheckpoints.mockResolvedValue({
            checkpointsExamined: 1,
            horizonsEvaluated: 2,
            observationsWritten: 12
        });
    });

    it("rejects a caller-supplied foreign company before evaluation", async () => {
        const response = await POST(post({ companyId: "tenant-b" }));

        expect(response.status).toBe(403);
        expect(mocks.evaluateMaturedCheckpoints).not.toHaveBeenCalled();
        expect(mocks.createChangeLog).not.toHaveBeenCalled();
    });

    it("evaluates only the signed-in tenant and records the authenticated user", async () => {
        const response = await POST(post({}));
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(mocks.evaluateMaturedCheckpoints).toHaveBeenCalledOnce();
        expect(mocks.evaluateMaturedCheckpoints).toHaveBeenCalledWith("tenant-a");
        expect(mocks.createChangeLog).toHaveBeenCalledWith({
            data: {
                companyId: "tenant-a",
                source: "evaluate-horizons",
                action: "manual_trigger",
                inputText: "Manually triggered canonical evaluator",
                diffJson: JSON.stringify({
                    userId: "user-a",
                    evaluation: {
                        checkpointsExamined: 1,
                        horizonsEvaluated: 2,
                        observationsWritten: 12
                    }
                }),
                forecastVersionHashAfter: "n/a"
            }
        });
        expect(body.evaluation).toEqual({
            checkpointsExamined: 1,
            horizonsEvaluated: 2,
            observationsWritten: 12
        });
    });

    it("requires a tenant resolved from the authenticated session", async () => {
        vi.mocked(resolveTenant).mockResolvedValue(null);

        const response = await POST(post({}));

        expect(response.status).toBe(401);
        expect(mocks.evaluateMaturedCheckpoints).not.toHaveBeenCalled();
        expect(mocks.createChangeLog).not.toHaveBeenCalled();
    });

    it("does not let a rejected concurrent request release the active tenant lock", async () => {
        let finishEvaluation!: (value: {
            checkpointsExamined: number;
            horizonsEvaluated: number;
            observationsWritten: number;
        }) => void;
        mocks.evaluateMaturedCheckpoints.mockReturnValueOnce(new Promise((resolve) => {
            finishEvaluation = resolve;
        }));

        const firstResponsePromise = POST(post({}));
        await vi.waitFor(() => expect(mocks.evaluateMaturedCheckpoints).toHaveBeenCalledTimes(1));

        const secondResponse = await POST(post({}));
        const thirdResponse = await POST(post({}));
        expect(secondResponse.status).toBe(409);
        expect(thirdResponse.status).toBe(409);

        finishEvaluation({ checkpointsExamined: 0, horizonsEvaluated: 0, observationsWritten: 0 });
        const firstResponse = await firstResponsePromise;
        expect(firstResponse.status).toBe(200);
    });
});
