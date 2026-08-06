import { syncVarianceLedger } from "../variance-sync";
import prisma from "@/db/prisma";
import { verifyBankCoverage } from "@/services/bank-coverage";
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mocking dependencies
vi.mock("@/db/prisma", () => ({
    default: {
        baselineSnapshot: { findUnique: vi.fn() },
        recurringPattern: { findMany: vi.fn() },
        baselineVarianceLedger: {
            findFirst: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
        },
        bankTransaction: { findMany: vi.fn() },
    }
}));

vi.mock("@/services/bank-coverage", () => ({
    verifyBankCoverage: vi.fn(),
}));

describe("syncVarianceLedger", () => {
    const mockCompanyId = "ep-test-company";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should skip writing ledger if bank coverage is unverified", async () => {
        // Mock baseline snapshot
        (prisma.baselineSnapshot.findUnique as any).mockResolvedValue({
            companyId: mockCompanyId,
            variableOutflowWeekly: 1000,
            variableInflowWeekly: 500,
        });

        // Mock unverified coverage
        (verifyBankCoverage as any).mockResolvedValue({ isVerified: false });

        await syncVarianceLedger(mockCompanyId);

        expect(verifyBankCoverage).toHaveBeenCalled();
        expect(prisma.bankTransaction.findMany).not.toHaveBeenCalled();
        expect(prisma.baselineVarianceLedger.create).not.toHaveBeenCalled();
        expect(prisma.baselineVarianceLedger.update).not.toHaveBeenCalled();
    });

    it("should write ledger for verified complete week", async () => {
        (prisma.baselineSnapshot.findUnique as any).mockResolvedValue({
            companyId: mockCompanyId,
            variableOutflowWeekly: 1000,
            variableInflowWeekly: 500,
        });

        (verifyBankCoverage as any).mockResolvedValue({ isVerified: true });
        
        // Mock 1 week of txs with no attributions (pure residual)
        (prisma.bankTransaction.findMany as any).mockResolvedValue([
            { amount: -200, direction: "outflow", attributions: [] },
            { amount: 100, direction: "inflow", attributions: [] }
        ]);

        await syncVarianceLedger(mockCompanyId);

        expect(prisma.bankTransaction.findMany).toHaveBeenCalled();
        
        // Since there are 8 weeks processed in the function, it should be called 8 times 
        // with the mock transactions, causing 8 creates.
        expect(prisma.baselineVarianceLedger.create).toHaveBeenCalled();
        
        const createCall = (prisma.baselineVarianceLedger.create as any).mock.calls[0][0].data;
        expect(createCall.actualOutflow).toBe(200);
        expect(createCall.actualInflow).toBe(100);
        expect(createCall.variancePct).toBeCloseTo((200 - 1000) / 1000); // -0.8
    });

    it("should remove confirmed AP and deterministic attribution from residual", async () => {
        (prisma.baselineSnapshot.findUnique as any).mockResolvedValue({
            companyId: mockCompanyId,
            variableOutflowWeekly: 1000,
            variableInflowWeekly: 500,
        });

        (verifyBankCoverage as any).mockResolvedValue({ isVerified: true });
        
        (prisma.bankTransaction.findMany as any).mockResolvedValue([
            { 
                amount: -500, direction: "outflow", 
                attributions: [
                    { direction: "outflow", isActive: true, isUserVerified: false, confidenceTier: "deterministic", amountAttributed: 200 }
                ] 
            },
            { 
                amount: -300, direction: "outflow", 
                attributions: [
                    { direction: "outflow", isActive: true, isUserVerified: true, confidenceTier: "med", amountAttributed: 300 }
                ] 
            }
        ]);

        // total flow = 800. Confirmed = 200 (deterministic) + 300 (user verified) = 500. Residual = 300.
        await syncVarianceLedger(mockCompanyId);

        const createCall = (prisma.baselineVarianceLedger.create as any).mock.calls[0][0].data;
        expect(createCall.actualOutflow).toBe(300); // 800 - 500
    });

    it("should exclude confirmed internal transfers", async () => {
        (prisma.baselineSnapshot.findUnique as any).mockResolvedValue({
            companyId: mockCompanyId,
            variableOutflowWeekly: 1000,
            variableInflowWeekly: 500,
        });

        (verifyBankCoverage as any).mockResolvedValue({ isVerified: true });
        
        (prisma.bankTransaction.findMany as any).mockResolvedValue([
            { amount: -500, direction: "outflow", internalTransferStatus: "confirmed", attributions: [] },
            { amount: -300, direction: "outflow", internalTransferStatus: "none", attributions: [] }
        ]);

        await syncVarianceLedger(mockCompanyId);

        const createCall = (prisma.baselineVarianceLedger.create as any).mock.calls[0][0].data;
        expect(createCall.actualOutflow).toBe(300); 
    });
});
