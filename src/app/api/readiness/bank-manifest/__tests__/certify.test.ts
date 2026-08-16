import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockPrisma = vi.hoisted(() => ({
    bankImportManifest: { findUnique: vi.fn() },
    $transaction: vi.fn()
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ resolveTenant: vi.fn() }));
vi.mock("@/db/prisma", () => ({ default: mockPrisma }));

import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import { POST } from "@/app/api/readiness/bank-manifest/certify/route";

const tenantA = "tenant-a";
const tenantB = "tenant-b";
const transactionClient = {
    bankImportManifest: { update: vi.fn() },
    bankImportManifestAccount: { updateMany: vi.fn() },
    changeLog: { create: vi.fn() }
};

function request(manifestId: string) {
    return new NextRequest("http://localhost/api/readiness/bank-manifest/certify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifestId })
    });
}

function manifest(companyId = tenantA, account = { id: "manifest-account-a", importSuccess: true, rejectedRowCount: 0 }) {
    return { id: "manifest-a", companyId, BankImportManifestAccount: [account] };
}

describe("bank manifest certification", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(auth).mockResolvedValue({ userId: "user-a" } as Awaited<ReturnType<typeof auth>>);
        vi.mocked(resolveTenant).mockResolvedValue(tenantA);
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(transactionClient));
        transactionClient.bankImportManifest.update.mockResolvedValue({});
        transactionClient.bankImportManifestAccount.updateMany.mockResolvedValue({ count: 1 });
        transactionClient.changeLog.create.mockResolvedValue({});
    });

    it("certifies an own successful manifest and records the authenticated user", async () => {
        mockPrisma.bankImportManifest.findUnique.mockResolvedValue(manifest());

        const response = await POST(request("manifest-a"));

        expect(response.status).toBe(200);
        expect(transactionClient.bankImportManifest.update).toHaveBeenCalledWith({
            where: { id: "manifest-a" },
            data: { userCertified: true }
        });
        expect(transactionClient.bankImportManifestAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { manifestId: "manifest-a" },
            data: { userCertifiedAt: expect.any(Date) }
        }));
        expect(transactionClient.changeLog.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ companyId: tenantA, userId: "user-a", action: "certify" })
        }));
    });

    it("rejects a foreign manifest without mutation", async () => {
        mockPrisma.bankImportManifest.findUnique.mockResolvedValue(manifest(tenantB));

        const response = await POST(request("manifest-a"));

        expect(response.status).toBe(403);
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
        { id: "failed", importSuccess: false, rejectedRowCount: 0 },
        { id: "rejected", importSuccess: true, rejectedRowCount: 1 }
    ])("rejects a non-certifiable $id manifest without mutation", async account => {
        mockPrisma.bankImportManifest.findUnique.mockResolvedValue(manifest(tenantA, account));

        const response = await POST(request("manifest-a"));

        expect(response.status).toBe(400);
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
});
