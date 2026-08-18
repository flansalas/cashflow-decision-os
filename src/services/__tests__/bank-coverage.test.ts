import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
    mockPrisma: {
        bankAccount: { findMany: vi.fn() },
        bankImportManifestAccount: { findMany: vi.fn() },
        dataReadinessAttestation: { findMany: vi.fn() },
        bankTransaction: { findFirst: vi.fn() }
    }
}));

vi.mock("@/db/prisma", () => ({ default: mockPrisma }));

import { verifyBankCoverage } from "../bank-coverage";

describe("Bank Coverage Verification", () => {
    const companyId = "test-company";
    const account = { id: "account-a" };
    const weekStart = new Date("2026-08-01T00:00:00.000Z");
    const weekEnd = new Date("2026-08-07T23:59:59.999Z");

    beforeEach(() => {
        vi.clearAllMocks();
        mockPrisma.bankAccount.findMany.mockResolvedValue([]);
        mockPrisma.bankImportManifestAccount.findMany.mockResolvedValue([]);
        mockPrisma.dataReadinessAttestation.findMany.mockResolvedValue([]);
        mockPrisma.bankTransaction.findFirst.mockResolvedValue(null);
    });

    it("fails when there are no active bank accounts", async () => {
        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);

        expect(result.isVerified).toBe(false);
        expect(result.totalActiveAccounts).toBe(0);
        expect(result.reasons[0]).toMatch(/No active bank accounts/);
        expect(mockPrisma.bankAccount.findMany).toHaveBeenCalledWith({
            where: { companyId, isActive: true }
        });
    });

    it("fails when an active account lacks coverage", async () => {
        mockPrisma.bankAccount.findMany.mockResolvedValue([account]);

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);

        expect(result.isVerified).toBe(false);
        expect(result.uncoveredAccountIds).toEqual([account.id]);
    });

    it("accepts a clean certified manifest covering the full week", async () => {
        mockPrisma.bankAccount.findMany.mockResolvedValue([account]);
        mockPrisma.bankImportManifestAccount.findMany.mockResolvedValue([{
            coveredStartDate: new Date("2026-07-31T00:00:00.000Z"),
            coveredEndDate: new Date("2026-08-07T00:00:00.000Z")
        }]);

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);

        expect(result.isVerified).toBe(true);
        expect(result.coveredAccounts).toBe(1);
        expect(mockPrisma.bankImportManifestAccount.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    bankAccountId: account.id,
                    importSuccess: true,
                    rejectedRowCount: 0,
                    userCertifiedAt: { not: null },
                    BankImportManifest: { userCertified: true, companyId }
                })
            })
        );
    });

    it("combines adjacent certified manifest intervals", async () => {
        mockPrisma.bankAccount.findMany.mockResolvedValue([account]);
        mockPrisma.bankImportManifestAccount.findMany.mockResolvedValue([
            {
                coveredStartDate: weekStart,
                coveredEndDate: new Date("2026-08-03T00:00:00.000Z")
            },
            {
                coveredStartDate: new Date("2026-08-04T00:00:00.000Z"),
                coveredEndDate: new Date("2026-08-07T00:00:00.000Z")
            }
        ]);

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);

        expect(result.isVerified).toBe(true);
    });

    it("fails if certified manifest coverage ends before the week", async () => {
        mockPrisma.bankAccount.findMany.mockResolvedValue([account]);
        mockPrisma.bankImportManifestAccount.findMany.mockResolvedValue([{
            coveredStartDate: weekStart,
            coveredEndDate: new Date("2026-08-05T00:00:00.000Z")
        }]);

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);

        expect(result.isVerified).toBe(false);
    });

    it("combines a certified partial manifest with exact no-activity evidence", async () => {
        mockPrisma.bankAccount.findMany.mockResolvedValue([account]);
        mockPrisma.bankImportManifestAccount.findMany.mockResolvedValue([{
            coveredStartDate: weekStart,
            coveredEndDate: new Date("2026-08-05T00:00:00.000Z")
        }]);
        mockPrisma.dataReadinessAttestation.findMany.mockResolvedValue([{
            evidenceJson: JSON.stringify({
                coveredStartDate: "2026-08-06T00:00:00.000Z",
                coveredEndDate: weekEnd.toISOString()
            })
        }]);

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);

        expect(result.isVerified).toBe(true);
        expect(result.coveredAccounts).toBe(1);
    });

    it("combines two distinct no-activity intervals around certified activity", async () => {
        mockPrisma.bankAccount.findMany.mockResolvedValue([account]);
        mockPrisma.bankImportManifestAccount.findMany.mockResolvedValue([{
            coveredStartDate: new Date("2026-08-03T00:00:00.000Z"),
            coveredEndDate: new Date("2026-08-05T00:00:00.000Z")
        }]);
        mockPrisma.dataReadinessAttestation.findMany.mockResolvedValue([
            {
                evidenceJson: JSON.stringify({
                    coveredStartDate: weekStart.toISOString(),
                    coveredEndDate: "2026-08-02T23:59:59.999Z"
                })
            },
            {
                evidenceJson: JSON.stringify({
                    coveredStartDate: "2026-08-06T00:00:00.000Z",
                    coveredEndDate: weekEnd.toISOString()
                })
            }
        ]);

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);

        expect(result.isVerified).toBe(true);
        expect(mockPrisma.bankTransaction.findFirst).toHaveBeenCalledTimes(2);
    });

    it("accepts exact full-week no-activity evidence when the account has no transactions", async () => {
        mockPrisma.bankAccount.findMany.mockResolvedValue([account]);
        mockPrisma.dataReadinessAttestation.findMany.mockResolvedValue([{
            evidenceJson: JSON.stringify({
                coveredStartDate: weekStart.toISOString(),
                coveredEndDate: weekEnd.toISOString()
            })
        }]);

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);

        expect(result.isVerified).toBe(true);
        expect(mockPrisma.bankTransaction.findFirst).toHaveBeenCalledWith({
            where: {
                companyId,
                accountId: account.id,
                txDate: { gte: weekStart, lte: weekEnd }
            },
            select: { id: true }
        });
    });

    it("fails when composed evidence leaves a gap", async () => {
        mockPrisma.bankAccount.findMany.mockResolvedValue([account]);
        mockPrisma.bankImportManifestAccount.findMany.mockResolvedValue([{
            coveredStartDate: weekStart,
            coveredEndDate: new Date("2026-08-03T00:00:00.000Z")
        }]);
        mockPrisma.dataReadinessAttestation.findMany.mockResolvedValue([{
            evidenceJson: JSON.stringify({
                coveredStartDate: "2026-08-05T00:00:00.000Z",
                coveredEndDate: weekEnd.toISOString()
            })
        }]);

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);

        expect(result.isVerified).toBe(false);
        expect(result.uncoveredAccountIds).toEqual([account.id]);
    });

    it("rejects no-activity evidence that contains a bank transaction", async () => {
        mockPrisma.bankAccount.findMany.mockResolvedValue([account]);
        mockPrisma.dataReadinessAttestation.findMany.mockResolvedValue([{
            evidenceJson: JSON.stringify({
                coveredStartDate: weekStart.toISOString(),
                coveredEndDate: weekEnd.toISOString()
            })
        }]);
        mockPrisma.bankTransaction.findFirst.mockResolvedValue({ id: "transaction-a" });

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);

        expect(result.isVerified).toBe(false);
        expect(result.uncoveredAccountIds).toEqual([account.id]);
    });

    it("ignores malformed no-activity evidence", async () => {
        mockPrisma.bankAccount.findMany.mockResolvedValue([account]);
        mockPrisma.dataReadinessAttestation.findMany.mockResolvedValue([{
            evidenceJson: "not-json"
        }]);

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);

        expect(result.isVerified).toBe(false);
        expect(mockPrisma.bankTransaction.findFirst).not.toHaveBeenCalled();
    });
});
