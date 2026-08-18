// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ReadinessPage from "@/app/readiness/page";

const readiness = {
    status: "operational_only",
    dimensions: {
        accountsReceivable: { status: "decision_ready", detail: "OK" },
        accountsPayable: { status: "decision_ready", detail: "OK" },
        recurringPatterns: { status: "decision_ready", detail: "OK" },
        bankCoverage: { status: "operational_only", detail: "Evidence required" }
    }
};

const bankEvidence = {
    accounts: [{ id: "account-a", name: "Operating", role: "operating" }],
    manifests: [{
        id: "manifest-a",
        userCertified: false,
        createdAt: "2026-08-16T00:00:00.000Z",
        BankImportManifestAccount: [{
            bankAccountId: "account-a",
            coveredStartDate: "2026-08-01T00:00:00.000Z",
            coveredEndDate: "2026-08-10T00:00:00.000Z",
            userCertifiedAt: null
        }]
    }]
};

const mockFetch = vi.fn();

describe("readiness bank evidence UI", () => {
    beforeEach(() => {
        mockFetch.mockReset();
        mockFetch.mockImplementation(async (url: string) => {
            if (url === "/api/readiness") return { ok: true, json: async () => readiness };
            if (url === "/api/readiness/bank-evidence") return { ok: true, json: async () => bankEvidence };
            if (url === "/api/readiness/bank-manifest/certify") return { ok: true, json: async () => ({}) };
            if (url === "/api/readiness/attest") return { ok: true, json: async () => ({}) };
            throw new Error(`Unexpected fetch: ${url}`);
        });
        global.fetch = mockFetch as any;
    });

    afterEach(cleanup);

    it("separates manifest certification from a confirmed account-specific no-activity interval", async () => {
        render(<ReadinessPage />);

        await screen.findByText("Account-level bank evidence");
        expect(screen.getByRole("button", { name: "Certify uploaded manifest" })).toBeDefined();
        expect(screen.getByRole("button", { name: "Record no-activity evidence" })).toBeDefined();

        fireEvent.click(screen.getByRole("button", { name: "Certify uploaded manifest" }));
        await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
            "/api/readiness/bank-manifest/certify",
            expect.objectContaining({ body: JSON.stringify({ manifestId: "manifest-a" }) })
        ));

        fireEvent.change(screen.getByLabelText("Covered start"), { target: { value: "2026-08-09T15:45" } });
        fireEvent.change(screen.getByLabelText("Covered end"), { target: { value: "2026-08-10T00:00" } });
        fireEvent.click(screen.getByRole("checkbox"));
        fireEvent.click(screen.getByRole("button", { name: "Record no-activity evidence" }));

        await waitFor(() => {
            const attestationCall = mockFetch.mock.calls.find(([url]) => url === "/api/readiness/attest");
            expect(attestationCall).toBeDefined();
            const payload = JSON.parse(attestationCall![1].body);
            expect(payload).toMatchObject({ scopeType: "bank_no_activity", scopeKey: "account-a" });
            expect(JSON.parse(payload.evidenceJson)).toMatchObject({
                coveredStartDate: new Date("2026-08-09T15:45").toISOString(),
                coveredEndDate: new Date("2026-08-10T00:00").toISOString()
            });
            expect(payload.companyId).toBeUndefined();
        });
    });

    it("shows fresh uncertified manifests when the prior bank readiness status is decision ready", async () => {
        mockFetch.mockImplementation(async (url: string) => {
            if (url === "/api/readiness") {
                return {
                    ok: true,
                    json: async () => ({
                        ...readiness,
                        status: "decision_ready",
                        dimensions: {
                            ...readiness.dimensions,
                            bankCoverage: { status: "decision_ready", detail: "OK" }
                        }
                    })
                };
            }
            if (url === "/api/readiness/bank-evidence") return { ok: true, json: async () => bankEvidence };
            throw new Error(`Unexpected fetch: ${url}`);
        });

        render(<ReadinessPage />);

        await screen.findByText("Account-level bank evidence");
        expect(screen.getByText("Manifest manifest-a")).toBeDefined();
        expect(screen.getByRole("button", { name: "Certify uploaded manifest" })).toBeDefined();
    });
});
