// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BankCoverageReview } from "../BankCoverageReview";

vi.mock("lucide-react", () => ({
    AlertTriangle: () => null,
    CheckCircle2: () => null,
    Landmark: () => null,
    Loader2: () => null,
    Upload: () => null,
}));

const weekStart = "2026-08-16T00:00:00.000Z";
const weekEnd = "2026-08-22T23:59:59.999Z";

function ok(data: unknown) {
    return { ok: true, json: async () => data } as Response;
}

describe("BankCoverageReview", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it("turns certified transaction-date coverage into exact no-activity gap attestations", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === "/api/readiness/bank-evidence") {
                return ok({
                    accounts: [{ id: "account-ub", name: "UB 0446", role: "operating" }],
                    manifests: [{
                        id: "manifest-ub",
                        userCertified: true,
                        createdAt: "2026-08-23T00:00:00.000Z",
                        BankImportManifestAccount: [{
                            bankAccountId: "account-ub",
                            coveredStartDate: "2026-08-18T12:00:00.000Z",
                            coveredEndDate: "2026-08-20T12:00:00.000Z",
                            userCertifiedAt: "2026-08-23T00:05:00.000Z",
                        }],
                    }],
                });
            }
            if (url.startsWith("/api/upload/bank/status?")) {
                return ok({
                    hasData: true,
                    rowCount: 33,
                    isVerified: false,
                    coverageDetails: { uncoveredAccountIds: ["account-ub"] },
                });
            }
            if (url === "/api/readiness/attest" && init?.method === "POST") {
                return ok({ id: "attestation" });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        global.fetch = fetchMock as typeof fetch;

        render(
            <BankCoverageReview
                companyId="company-a"
                weekStart={weekStart}
                weekEnd={weekEnd}
                onBackToUpload={vi.fn()}
                onContinue={vi.fn()}
            />
        );

        expect(await screen.findByText(/Uncovered periods: Aug 16–Aug 17 and Aug 21–Aug 22/)).toBeDefined();
        fireEvent.click(screen.getByLabelText(/I checked UB 0446/));
        fireEvent.click(screen.getByRole("button", { name: "Confirm no activity for UB 0446" }));

        await waitFor(() => {
            const requests = fetchMock.mock.calls.filter(call => String(call[0]) === "/api/readiness/attest");
            expect(requests).toHaveLength(2);
        });

        const evidence = fetchMock.mock.calls
            .filter(call => String(call[0]) === "/api/readiness/attest")
            .map(call => JSON.parse(JSON.parse(String(call[1]?.body)).evidenceJson));

        expect(evidence).toEqual(expect.arrayContaining([
            {
                coveredStartDate: "2026-08-16T00:00:00.000Z",
                coveredEndDate: "2026-08-17T23:59:59.999Z",
            },
            {
                coveredStartDate: "2026-08-21T00:00:00.000Z",
                coveredEndDate: "2026-08-22T23:59:59.999Z",
            },
        ]));
    });

    it("certifies a successful uploaded manifest before offering gap confirmation", async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url === "/api/readiness/bank-evidence") {
                return ok({
                    accounts: [{ id: "account-ub", name: "UB 0446", role: "operating" }],
                    manifests: [{
                        id: "manifest-ub",
                        userCertified: false,
                        createdAt: "2026-08-23T00:00:00.000Z",
                        BankImportManifestAccount: [{
                            bankAccountId: "account-ub",
                            coveredStartDate: "2026-08-16T00:00:00.000Z",
                            coveredEndDate: "2026-08-22T23:59:59.999Z",
                            userCertifiedAt: null,
                        }],
                    }],
                });
            }
            if (url.startsWith("/api/upload/bank/status?")) {
                return ok({
                    hasData: true,
                    rowCount: 33,
                    isVerified: false,
                    coverageDetails: { uncoveredAccountIds: ["account-ub"] },
                });
            }
            if (url === "/api/readiness/bank-manifest/certify" && init?.method === "POST") {
                return ok({ manifestId: "manifest-ub", userCertified: true });
            }
            throw new Error(`Unexpected request: ${url}`);
        });
        global.fetch = fetchMock as typeof fetch;

        render(
            <BankCoverageReview
                companyId="company-a"
                weekStart={weekStart}
                weekEnd={weekEnd}
                onBackToUpload={vi.fn()}
                onContinue={vi.fn()}
            />
        );

        fireEvent.click(await screen.findByRole("button", { name: /Certify uploaded statement.*UB 0446/ }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                "/api/readiness/bank-manifest/certify",
                expect.objectContaining({ body: JSON.stringify({ manifestId: "manifest-ub" }) })
            );
        });
    });

    it("continues with verified learning eligibility only after the authority reports full coverage", async () => {
        global.fetch = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === "/api/readiness/bank-evidence") {
                return ok({ accounts: [{ id: "account-ub", name: "UB 0446", role: "operating" }], manifests: [] });
            }
            if (url.startsWith("/api/upload/bank/status?")) {
                return ok({
                    hasData: true,
                    rowCount: 33,
                    isVerified: true,
                    coverageDetails: { uncoveredAccountIds: [] },
                });
            }
            throw new Error(`Unexpected request: ${url}`);
        }) as typeof fetch;
        const onContinue = vi.fn();

        render(
            <BankCoverageReview
                companyId="company-a"
                weekStart={weekStart}
                weekEnd={weekEnd}
                onBackToUpload={vi.fn()}
                onContinue={onContinue}
            />
        );

        expect(await screen.findByText(/eligible for verified accuracy and learning/)).toBeDefined();
        fireEvent.click(screen.getByRole("button", { name: "Continue — Coverage Verified" }));

        expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ isVerified: true, rowCount: 33 }));
    });
});
