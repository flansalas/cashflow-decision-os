import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
    createChangeLog: vi.fn(),
    findCheckpoints: vi.fn(),
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({
        changeLog: { create: mocks.createChangeLog }
    }))
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ resolveTenant: vi.fn() }));
vi.mock("@/db/prisma", () => ({
    default: {
        $transaction: mocks.transaction,
        forecastCheckpoint: { findMany: mocks.findCheckpoints }
    }
}));
vi.mock("@/services/forecast-certification", () => ({
    evaluateForecastRisk: vi.fn(),
    certifyForecastVersion: vi.fn(),
    ForecastGovernanceError: class ForecastGovernanceError extends Error {
        httpStatus = 400;
    }
}));

import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import {
    certifyForecastVersion,
    evaluateForecastRisk
} from "@/services/forecast-certification";
import { POST as evaluate } from "@/app/api/forecast/certification/evaluate/route";
import { POST as decide } from "@/app/api/forecast/certification/route";
import { GET as eligible } from "@/app/api/forecast-checkpoint/eligible/route";

function post(url: string, body: object) {
    return new NextRequest(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

describe("Package 3 authenticated tenant controls", () => {
    const reviewedAuthority = {
        forecastCheckpointId: "checkpoint-a",
        forecastVersionHash: "forecast-hash-a",
        cashSnapshotId: "cash-a",
        readinessEvidenceHash: "readiness-hash-a",
        downsideScenarioId: "scenario-a",
        downsideScenarioHash: "scenario-hash-a",
        bufferAssumptionId: "assumption-a",
        bufferAmount: 500
    };

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(auth).mockResolvedValue({ userId: "clerk-user-a" } as Awaited<ReturnType<typeof auth>>);
        vi.mocked(resolveTenant).mockResolvedValue("tenant-a");
    });

    it("rejects caller-supplied foreign company authority for evaluation and decision", async () => {
        const evaluateResponse = await evaluate(post(
            "http://localhost/api/forecast/certification/evaluate",
            { companyId: "tenant-b", forecastCheckpointId: "checkpoint-b", stressInputs: {} }
        ));
        const decisionResponse = await decide(post(
            "http://localhost/api/forecast/certification",
            { companyId: "tenant-b", forecastCheckpointId: "checkpoint-b", status: "certified", stressInputs: {} }
        ));

        expect(evaluateResponse.status).toBe(403);
        expect(decisionResponse.status).toBe(403);
        expect(evaluateForecastRisk).not.toHaveBeenCalled();
        expect(certifyForecastVersion).not.toHaveBeenCalled();
    });

    it("evaluates the resolved tenant without creating a final decision", async () => {
        vi.mocked(evaluateForecastRisk).mockResolvedValue({
            eligibility: { canFinalizeDecision: true }
        } as never);

        const response = await evaluate(post(
            "http://localhost/api/forecast/certification/evaluate",
            { forecastCheckpointId: "checkpoint-a", stressInputs: { arDelayWeeks: 4, residualInflowReductionPct: 20 } }
        ));

        expect(response.status).toBe(200);
        expect(evaluateForecastRisk).toHaveBeenCalledWith(
            "tenant-a",
            "checkpoint-a",
            { arDelayWeeks: 4, residualInflowReductionPct: 20 }
        );
        expect(certifyForecastVersion).not.toHaveBeenCalled();
        expect(mocks.createChangeLog).not.toHaveBeenCalled();
    });

    it("uses the authenticated Clerk user for the finalized decision and audit", async () => {
        vi.mocked(certifyForecastVersion).mockResolvedValue({
            id: "cert-a",
            status: "certified",
            decidedAt: new Date("2026-08-16T12:00:00.000Z"),
            forecastVersionHash: "forecast-hash-a"
        } as never);

        const response = await decide(post(
            "http://localhost/api/forecast/certification",
            {
                forecastCheckpointId: "checkpoint-a",
                status: "certified",
                stressInputs: { arDelayWeeks: 4, residualInflowReductionPct: 20 },
                bufferRationale: "Owner rationale",
                reviewedAuthority,
                decidedBy: "forged-user"
            }
        ));

        expect(response.status).toBe(200);
        expect(certifyForecastVersion).toHaveBeenCalledWith(
            "tenant-a",
            "checkpoint-a",
            expect.objectContaining({ status: "certified", decidedBy: "clerk-user-a" }),
            { arDelayWeeks: 4, residualInflowReductionPct: 20 },
            "Owner rationale",
            reviewedAuthority,
            expect.anything()
        );
        expect(mocks.createChangeLog).toHaveBeenCalledWith({
            data: expect.objectContaining({
                companyId: "tenant-a",
                userId: "clerk-user-a",
                action: "CERTIFIED",
                forecastVersionHashAfter: "forecast-hash-a"
            })
        });
    });

    it("tenant-scopes eligible checkpoint reads and rejects foreign company queries", async () => {
        const foreignResponse = await eligible(new NextRequest(
            "http://localhost/api/forecast-checkpoint/eligible?companyId=tenant-b"
        ));
        expect(foreignResponse.status).toBe(403);
        expect(mocks.findCheckpoints).not.toHaveBeenCalled();
    });
});
