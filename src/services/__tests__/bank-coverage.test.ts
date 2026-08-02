import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import prisma from "@/db/prisma";
import { verifyBankCoverage } from "../bank-coverage";

describe("Bank Coverage Verification", () => {
    const companyId = "test-company-" + Math.random().toString(36).substring(7);
    const weekStart = new Date("2026-08-01T00:00:00Z");
    const weekEnd = new Date("2026-08-07T23:59:59Z");

    beforeAll(async () => {
        await prisma.company.create({
            data: { id: companyId, name: "Coverage Test Company" }
        });
    });

    afterAll(async () => {
        await prisma.company.delete({ where: { id: companyId } });
    });

    beforeEach(async () => {
        await prisma.bankImportManifestAccount.deleteMany({ where: { BankImportManifest: { companyId } } });
        await prisma.bankImportManifest.deleteMany({ where: { companyId } });
        await prisma.bankAccount.deleteMany({ where: { companyId } });
    });

    it("fails when there are no active bank accounts", async () => {
        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);
        expect(result.isVerified).toBe(false);
        expect(result.reasons[0]).toMatch(/No active bank accounts/);
    });

    it("ignores inactive bank accounts", async () => {
        await prisma.bankAccount.create({
            data: { companyId, isActive: false, name: "Inactive Account" }
        });
        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);
        expect(result.isVerified).toBe(false);
        expect(result.totalActiveAccounts).toBe(0);
    });

    it("fails when an active account lacks coverage", async () => {
        await prisma.bankAccount.create({
            data: { companyId, isActive: true, name: "Active Account" }
        });
        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);
        expect(result.isVerified).toBe(false);
        expect(result.uncoveredAccountIds.length).toBe(1);
    });

    it("succeeds when all active accounts have certified, clean, complete coverage", async () => {
        const acc = await prisma.bankAccount.create({
            data: { companyId, isActive: true, name: "Active Account" }
        });
        const manifest = await prisma.bankImportManifest.create({
            data: { id: "test-manifest-1", companyId, userCertified: true }
        });
        await prisma.bankImportManifestAccount.create({
            data: {
                id: "test-manifest-acc-1",
                manifestId: manifest.id,
                bankAccountId: acc.id,
                coveredStartDate: new Date("2026-07-01T00:00:00Z"), // before weekStart
                coveredEndDate: new Date("2026-08-10T00:00:00Z"), // after weekEnd
                importSuccess: true,
                rejectedRowCount: 0,
                userCertifiedAt: new Date()
            }
        });

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);
        expect(result.isVerified).toBe(true);
        expect(result.coveredAccounts).toBe(1);
    });

    it("fails if coverage has rejected rows", async () => {
        const acc = await prisma.bankAccount.create({
            data: { companyId, isActive: true, name: "Active Account" }
        });
        const manifest = await prisma.bankImportManifest.create({
            data: { id: "test-manifest-2", companyId, userCertified: true }
        });
        await prisma.bankImportManifestAccount.create({
            data: {
                id: "test-manifest-acc-2",
                manifestId: manifest.id,
                bankAccountId: acc.id,
                coveredStartDate: weekStart,
                coveredEndDate: weekEnd,
                importSuccess: true,
                rejectedRowCount: 1, // <--- Fail
                userCertifiedAt: new Date()
            }
        });

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);
        expect(result.isVerified).toBe(false);
    });

    it("fails if manifest is uncertified (forged UI bypass)", async () => {
        const acc = await prisma.bankAccount.create({
            data: { companyId, isActive: true, name: "Active Account" }
        });
        const manifest = await prisma.bankImportManifest.create({
            data: { id: "test-manifest-3", companyId, userCertified: false } // <--- Fail
        });
        await prisma.bankImportManifestAccount.create({
            data: {
                id: "test-manifest-acc-3",
                manifestId: manifest.id,
                bankAccountId: acc.id,
                coveredStartDate: weekStart,
                coveredEndDate: weekEnd,
                importSuccess: true,
                rejectedRowCount: 0,
                userCertifiedAt: new Date()
            }
        });

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);
        expect(result.isVerified).toBe(false);
    });

    it("fails if coverage ends before weekEnd", async () => {
        const acc = await prisma.bankAccount.create({
            data: { companyId, isActive: true, name: "Active Account" }
        });
        const manifest = await prisma.bankImportManifest.create({
            data: { id: "test-manifest-4", companyId, userCertified: true }
        });
        await prisma.bankImportManifestAccount.create({
            data: {
                id: "test-manifest-acc-4",
                manifestId: manifest.id,
                bankAccountId: acc.id,
                coveredStartDate: weekStart,
                coveredEndDate: new Date("2026-08-05T00:00:00Z"), // <--- Fail (ends before Aug 7)
                importSuccess: true,
                rejectedRowCount: 0,
                userCertifiedAt: new Date()
            }
        });

        const result = await verifyBankCoverage(companyId, weekStart, weekEnd);
        expect(result.isVerified).toBe(false);
    });
});
