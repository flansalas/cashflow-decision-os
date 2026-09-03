// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionPlanModal } from "../ExecutionPlanModal";
import { StandaloneExecutionPlanModal } from "../StandaloneExecutionPlanModal";

vi.mock("lucide-react", () => ({
    CheckCircle: () => null,
    Eye: () => null,
    EyeOff: () => null,
    Lock: () => null,
    Phone: () => null,
    Printer: () => null,
    RefreshCw: () => null,
    Zap: () => null,
}));

const weeks = Array.from({ length: 13 }, (_, index) => ({
    weekNumber: index + 1,
    weekStart: new Date(Date.UTC(2026, 7, 24 + index * 7)).toISOString(),
    weekEnd: new Date(Date.UTC(2026, 7, 30 + index * 7)).toISOString(),
}));

const baseProps = {
    companyId: "company-a",
    weeks,
    invoices: [],
    bills: [],
    openingCash: 500_153,
    breakdown: { inflows: [], outflows: [] },
    onClose: vi.fn(),
};

describe("execution plan safety", () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("fails closed instead of crashing when approved mode has no approved plan data", () => {
        render(
            <ExecutionPlanModal
                {...baseProps}
                executionPlan={null}
                initialMode="approved"
            />
        );

        expect(screen.getByText("Error: Missing Approved Data")).toBeDefined();
    });

    it("shows the server rejection when approval is blocked", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.startsWith("/api/forecast-checkpoint/eligible")) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        checkpoints: [{
                            id: "checkpoint-a",
                            sealedAt: "2026-08-25T20:47:03.272Z",
                            forecastVersionHash: "ba22b6856babdee1d8a26e2133e6e46e39a485a83d2168ef5ca6af411961d021",
                        }],
                    }),
                } as Response;
            }
            if (url === "/api/execution-plan" && init?.method === "POST") {
                return {
                    ok: false,
                    status: 400,
                    json: async () => ({
                        error: "Cannot approve plan: Company data is not decision-ready (Status: operational_only)",
                    }),
                } as Response;
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        vi.stubGlobal("fetch", fetchMock);

        render(
            <ExecutionPlanModal
                {...baseProps}
                executionPlan={null}
                initialMode="select"
            />
        );

        await screen.findByText(/ba22b685/);
        fireEvent.change(screen.getByPlaceholderText("Owner Name (Required)"), {
            target: { value: "John Michael" },
        });
        fireEvent.click(screen.getByRole("button", { name: /Approve & Print Plan/ }));

        expect((await screen.findByRole("alert")).textContent).toContain(
            "Cannot approve plan: Company data is not decision-ready (Status: operational_only)"
        );
    });

    it("keeps the dashboard recoverable when the grid endpoint returns invalid data", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ weeks: [], invoices: [], bills: [] }),
        })));

        render(
            <StandaloneExecutionPlanModal
                companyId="company-a"
                onClose={vi.fn()}
                initialMode="select"
            />
        );

        expect(await screen.findByText("Execution Plan Unavailable")).toBeDefined();
        expect(screen.getByText("The execution plan response is incomplete.")).toBeDefined();
    });
});
