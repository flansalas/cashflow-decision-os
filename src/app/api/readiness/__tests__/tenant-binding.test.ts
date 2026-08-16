import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@clerk/nextjs/server", () => ({
    auth: vi.fn()
}));

vi.mock("@/lib/tenant", () => ({
    resolveTenant: vi.fn()
}));

vi.mock("@/db/prisma", () => ({
    default: {
        bankAccount: {
            findFirst: vi.fn()
        },
        dataReadinessAttestation: {
            updateMany: vi.fn(),
            create: vi.fn()
        }
    }
}));

vi.mock("@/services/data-readiness-evaluation", () => ({
    evaluateCompanyDataReadiness: vi.fn(),
    computeARPopulationHash: vi.fn(),
    computeAPPopulationHash: vi.fn(),
    computeRecurringPopulationHash: vi.fn()
}));

import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";
import {
    computeAPPopulationHash,
    computeARPopulationHash,
    computeRecurringPopulationHash,
    evaluateCompanyDataReadiness
} from "@/services/data-readiness-evaluation";
import { GET } from "@/app/api/readiness/route";
import { POST } from "@/app/api/readiness/attest/route";

const tenantA = "tenant-a";
const tenantB = "tenant-b";
const readinessResult = {
    status: "operational_only" as const,
    asOfDate: new Date("2026-08-16T00:00:00.000Z"),
    cashSnapshotId: "snapshot-a",
    dimensions: {
        startingCash: { status: "decision_ready" as const, detail: "Current" },
        bankCoverage: { status: "operational_only" as const, detail: "Evidence required" },
        accountsReceivable: { status: "decision_ready" as const, detail: "Certified" },
        accountsPayable: { status: "decision_ready" as const, detail: "Certified" },
        recurringPatterns: { status: "decision_ready" as const, detail: "Certified" },
        unresolvedConflicts: { status: "decision_ready" as const, detail: "None" },
        baselineProvenance: { status: "decision_ready" as const, detail: "Bound" }
    },
    blockingReasons: []
};

function makePostRequest(body: object): NextRequest {
    return new NextRequest("http://localhost/api/readiness/attest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

describe("Package 2B readiness tenant binding", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(auth).mockResolvedValue({ userId: "user-a" } as Awaited<ReturnType<typeof auth>>);
        vi.mocked(resolveTenant).mockResolvedValue(tenantA);
    });

    it("does not expose tenant B readiness when tenant A supplies tenant B in the query", async () => {
        vi.mocked(evaluateCompanyDataReadiness).mockResolvedValue(readinessResult);

        const response = await GET(new NextRequest(`http://localhost/api/readiness?companyId=${tenantB}`));

        expect(response.status).toBe(403);
        expect(resolveTenant).toHaveBeenCalledOnce();
        expect(evaluateCompanyDataReadiness).not.toHaveBeenCalled();
    });

    it("resolves normal authenticated readiness for the caller's own tenant", async () => {
        vi.mocked(evaluateCompanyDataReadiness).mockResolvedValue(readinessResult);

        const response = await GET(new NextRequest("http://localhost/api/readiness"));
        const data = await response.json();

        expect(response.status).toBe(200);
        expect(data.status).toBe("operational_only");
        expect(evaluateCompanyDataReadiness).toHaveBeenCalledWith(tenantA, expect.any(Date));
    });

    it("rejects an attestation for a different tenant", async () => {
        const response = await POST(makePostRequest({
            companyId: tenantB,
            scopeType: "ar",
            asOfDate: "2026-08-16T00:00:00.000Z",
            evidenceJson: JSON.stringify({ manual: true }),
            certifiedBy: "forged-user"
        }));

        expect(response.status).toBe(403);
        expect(computeARPopulationHash).not.toHaveBeenCalled();
        expect(prisma.dataReadinessAttestation.create).not.toHaveBeenCalled();
    });

    it("rejects a bank_no_activity attestation for a foreign bank account", async () => {
        vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue(null);

        const response = await POST(makePostRequest({
            scopeType: "bank_no_activity",
            scopeKey: "bank-account-b",
            asOfDate: "2026-08-16T00:00:00.000Z",
            evidenceJson: JSON.stringify({ intervalStart: "2026-08-01", intervalEnd: "2026-08-15" })
        }));

        expect(response.status).toBe(403);
        expect(prisma.bankAccount.findFirst).toHaveBeenCalledWith({
            where: { id: "bank-account-b", companyId: tenantA },
            select: { id: true }
        });
        expect(prisma.dataReadinessAttestation.updateMany).not.toHaveBeenCalled();
        expect(prisma.dataReadinessAttestation.create).not.toHaveBeenCalled();
        expect(computeAPPopulationHash).not.toHaveBeenCalled();
        expect(computeRecurringPopulationHash).not.toHaveBeenCalled();
    });
});
