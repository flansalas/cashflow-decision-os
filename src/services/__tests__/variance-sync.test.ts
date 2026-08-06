import { syncVarianceLedger } from "../variance-sync";
import prisma from "@/db/prisma";
import { verifyBankCoverage } from "@/services/bank-coverage";
import { calculateResidualActuals } from "@/services/attribution";
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock("@/db/prisma", () => ({
    __esModule: true,
    default: {
        baselineSnapshot: { findUnique: vi.fn() },
        recurringPattern: { findMany: vi.fn() },
        baselineVarianceLedger: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
        forecastCheckpoint: { findFirst: vi.fn() },
        bankTransaction: { findMany: vi.fn() },
    }
}));

vi.mock("@/services/bank-coverage", () => ({
    verifyBankCoverage: vi.fn()
}));

describe("variance-sync Evidence Gate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (prisma.baselineSnapshot.findUnique as any).mockResolvedValue({
            variableOutflowWeekly: 1000,
            variableInflowWeekly: 500
        });
        (prisma.recurringPattern.findMany as any).mockResolvedValue([]);
    });

    it("does not update ledger if bank coverage is unverified", async () => {
        (verifyBankCoverage as any).mockResolvedValue({ isVerified: false });
        
        await syncVarianceLedger("test-company");

        expect(prisma.baselineVarianceLedger.create).not.toHaveBeenCalled();
        expect(prisma.baselineVarianceLedger.update).not.toHaveBeenCalled();
    });

    it("does not update ledger if checkpoint is not verified", async () => {
        (verifyBankCoverage as any).mockResolvedValue({ isVerified: true });
        (prisma.forecastCheckpoint.findFirst as any).mockResolvedValue(null);
        
        await syncVarianceLedger("test-company");

        expect(prisma.baselineVarianceLedger.create).not.toHaveBeenCalled();
        expect(prisma.baselineVarianceLedger.update).not.toHaveBeenCalled();
    });

    it("updates ledger for a verified complete week", async () => {
        (verifyBankCoverage as any).mockResolvedValue({ isVerified: true });
        (prisma.forecastCheckpoint.findFirst as any).mockResolvedValue({ id: "cp-1", isBankCoverageVerified: true });
        (prisma.baselineVarianceLedger.findFirst as any).mockResolvedValue(null); // No existing
        
        // Mock transactions 
        (prisma.bankTransaction.findMany as any).mockResolvedValue([
            { amount: -500, direction: "outflow", attributions: [] }
        ]);

        await syncVarianceLedger("test-company");

        expect(prisma.baselineVarianceLedger.create).toHaveBeenCalled();
    });
});

describe("calculateResidualActuals", () => {
    it("subtracts confirmed human allocations", () => {
        const txs = [
            {
                amount: -1000, direction: "outflow",
                internalTransferStatus: "none",
                attributions: [
                    { direction: "outflow", amountAttributed: 300, isUserVerified: true, isActive: true }
                ]
            }
        ];
        const res = calculateResidualActuals(txs);
        expect(res.residualOutflow).toBe(700);
    });

    it("subtracts confirmed deterministic matches", () => {
        const txs = [
            {
                amount: -1000, direction: "outflow",
                internalTransferStatus: "none",
                attributions: [
                    { direction: "outflow", amountAttributed: 400, attributionMethod: "deterministic_match", isActive: true }
                ]
            }
        ];
        const res = calculateResidualActuals(txs);
        expect(res.residualOutflow).toBe(600);
    });

    it("does not subtract probable/inferred/high-confidence allocations", () => {
        const txs = [
            {
                amount: -1000, direction: "outflow",
                internalTransferStatus: "none",
                attributions: [
                    { direction: "outflow", amountAttributed: 500, confidenceTier: "high", attributionMethod: "ai_inferred", isActive: true, isUserVerified: false }
                ]
            }
        ];
        const res = calculateResidualActuals(txs);
        expect(res.residualOutflow).toBe(1000); // Should not subtract
    });

    it("excludes confirmed transfers entirely", () => {
        const txs = [
            { amount: -1000, direction: "outflow", internalTransferStatus: "confirmed", attributions: [] }
        ];
        const res = calculateResidualActuals(txs);
        expect(res.residualOutflow).toBe(0);
    });

    it("leaves partial allocation remainders", () => {
        const txs = [
            {
                amount: -1000, direction: "outflow", internalTransferStatus: "none",
                attributions: [
                    { direction: "outflow", amountAttributed: 400, isUserVerified: true, isActive: true }
                ]
            }
        ];
        const res = calculateResidualActuals(txs);
        expect(res.residualOutflow).toBe(600);
    });
});
