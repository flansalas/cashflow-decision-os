// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CertificationReviewPage from "@/app/review/certification/page";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ back: vi.fn() })
}));

const checkpoint = {
    id: "checkpoint-a",
    weekStart: "2026-08-17T00:00:00.000Z",
    weekEnd: "2026-11-15T00:00:00.000Z",
    generatedAt: "2026-08-16T12:00:00.000Z",
    sealedAt: "2026-08-16T12:01:00.000Z",
    cashAsOfDate: "2026-08-16T00:00:00.000Z",
    forecastVersionHash: "548564999dc273adf1f8a4eb48f75a5176e07f6a",
    isCurrent: true
};

const historicalCheckpoint = {
    ...checkpoint,
    id: "checkpoint-history",
    weekStart: "2026-08-10T00:00:00.000Z",
    weekEnd: "2026-11-08T00:00:00.000Z",
    isCurrent: false
};

const review = {
    checkpoint: { ...checkpoint, cashSnapshotId: "cash-a" },
    readiness: { status: "decision_ready", reasons: [], evidenceHash: "readiness-hash" },
    buffer: { amount: 15000, existingRationale: null, authoritative: true },
    stressSummary: ["Delay explicit AR by 4 week(s).", "Reduce residual inflow by 20%."],
    baseMetrics: {
        minCash: 40000,
        minCashWeek: checkpoint.weekStart,
        firstNegativeWeek: null,
        maxDeficit: 0,
        bufferHeadroom: 25000,
        firstBreachWeek: null
    },
    downsideMetrics: {
        minCash: 12000,
        minCashWeek: checkpoint.weekStart,
        firstNegativeWeek: null,
        maxDeficit: 0,
        bufferHeadroom: -3000,
        firstBreachWeek: checkpoint.weekStart
    },
    downsideScenario: { outsideHorizonAR: [] },
    decisionAuthority: {
        forecastCheckpointId: "checkpoint-a",
        forecastVersionHash: checkpoint.forecastVersionHash,
        cashSnapshotId: "cash-a",
        readinessEvidenceHash: "readiness-hash",
        downsideScenarioId: "scenario-a",
        downsideScenarioHash: "scenario-hash-a",
        bufferAssumptionId: "assumption-a",
        bufferAmount: 15000
    },
    eligibility: {
        status: "eligible",
        canFinalizeDecision: true,
        canCertify: true,
        prerequisiteFailures: []
    }
};

const mockFetch = vi.fn();

describe("Package 3 review-before-decision page", () => {
    beforeEach(() => {
        mockFetch.mockReset();
        mockFetch.mockImplementation(async (url: string) => {
            if (url === "/api/forecast-checkpoint/eligible") {
                return { ok: true, json: async () => ({ checkpoints: [checkpoint, historicalCheckpoint] }) };
            }
            if (url === "/api/forecast/certification/evaluate") {
                return { ok: true, json: async () => ({ review }) };
            }
            if (url === "/api/forecast/certification") {
                return {
                    ok: true,
                    json: async () => ({ certification: { id: "cert-a", status: "certified" } })
                };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        global.fetch = mockFetch as unknown as typeof fetch;
    });

    afterEach(cleanup);

    it("preselects the current sealed forecast and requires review before a final decision", async () => {
        render(<CertificationReviewPage />);

        const forecastSelect = await screen.findByLabelText("Sealed forecast") as HTMLSelectElement;
        await waitFor(() => expect(forecastSelect.value).toBe("checkpoint-a"));
        expect(screen.queryByLabelText("Forecast Checkpoint ID")).toBeNull();
        expect(screen.queryByRole("button", { name: "Certify for Decision Use" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Mark Not Safe" })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Evaluate Forecast Risk" }));

        await screen.findByText("Governed risk evaluation");
        expect(screen.getByText("Authoritative live buffer")).toBeDefined();
        expect(screen.getByText("$15,000")).toBeDefined();
        expect(screen.getByRole("button", { name: "Certify for Decision Use" })).toBeDefined();
        expect(screen.getByRole("button", { name: "Mark Not Safe" })).toBeDefined();
        expect(mockFetch).not.toHaveBeenCalledWith(
            "/api/forecast/certification",
            expect.anything()
        );

        fireEvent.change(screen.getByLabelText("Management decision rationale"), {
            target: { value: "Reviewed the exact downside path." }
        });
        fireEvent.change(screen.getByLabelText("Buffer rationale required for certification"), {
            target: { value: "The operating buffer reflects current obligations." }
        });
        fireEvent.click(screen.getByRole("button", { name: "Certify for Decision Use" }));

        await screen.findByText(/Final forecast-version decision recorded/);
        const decisionCall = mockFetch.mock.calls.find(([url]) => url === "/api/forecast/certification");
        expect(decisionCall).toBeDefined();
        const body = JSON.parse(decisionCall![1].body);
        expect(body).toMatchObject({
            forecastCheckpointId: "checkpoint-a",
            status: "certified",
            rationale: "Reviewed the exact downside path.",
            bufferRationale: "The operating buffer reflects current obligations.",
            stressInputs: { arDelayWeeks: 4, residualInflowReductionPct: 20 },
            reviewedAuthority: review.decisionAuthority
        });
        expect(body.companyId).toBeUndefined();
        expect(body.decidedBy).toBeUndefined();
    });
});
