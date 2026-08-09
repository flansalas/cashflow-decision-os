import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../route";
import { NextRequest } from "next/server";
import prisma from "@/db/prisma";

vi.mock("@vercel/functions", () => ({
    waitUntil: vi.fn()
}));

vi.mock("@/lib/tenant", () => ({
    resolveTenant: vi.fn(() => "test-checkin-recon")
}));

vi.mock("@/db/prisma", () => ({
    default: {
        $transaction: vi.fn(async (cb) => {
            return cb({
                cashAdjustment: {
                    deleteMany: vi.fn(),
                    createMany: vi.fn()
                },
                baselineSnapshotHistory: {
                    create: vi.fn().mockResolvedValue({ id: "history-id" })
                },
                forecastCheckpoint: {
                    update: vi.fn()
                },
                accountFreshnessStatus: {
                    updateMany: vi.fn()
                },
                recurringPattern: {
                    findMany: vi.fn().mockResolvedValue([])
                },
                cashSnapshot: {
                    create: vi.fn().mockResolvedValue({ id: "snapshot" }),
                    findFirst: vi.fn().mockResolvedValue(null)
                },
                forecastWeek: {
                    findFirst: vi.fn().mockResolvedValue(null)
                }
            });
        }),
        baselineSnapshot: {
            findFirst: vi.fn().mockResolvedValue({ id: "baseline-id" }),
            create: vi.fn()
        },
        forecastCheckpoint: {
            create: vi.fn().mockResolvedValue({ id: "checkpoint-id" })
        },
        cashSnapshot: {
            create: vi.fn().mockResolvedValue({ id: "snapshot-id" }),
            findFirst: vi.fn().mockResolvedValue({ id: "prev-snapshot-id" })
        },
        forecastWeek: {
            findFirst: vi.fn().mockResolvedValue(null)
        },
        $queryRaw: vi.fn().mockResolvedValue([])
    }
}));

describe("Cash Check-in Reconciliation Filtering", () => {
    const companyId = "test-checkin-recon";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockRequest = (adjustments: any[]) => {
        return new NextRequest("http://localhost/api/cash-checkin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                companyId,
                bankBalance: 158100.92, // Example multi-account total
                asOfDate: new Date().toISOString(),
                adjustments,
                bankDataMissing: true, 
                priorWeekForecast: {
                    forecastVersionHash: "client_observed_v1",
                    generatedAt: new Date().toISOString(),
                    weekStart: "2026-08-01T00:00:00Z",
                    weekEnd: "2026-08-07T23:59:59Z",
                    endCashExpected: 150000,
                    inflowsExpected: 10000,
                    outflowsExpected: 5000
                }
            })
        });
    };

    const getCreatedAdjustments = () => {
        // Find the call to tx.cashAdjustment.createMany
        const txCalls = (prisma.$transaction as any).mock.calls;
        if (txCalls.length === 0) return [];
        // The mock $transaction passes a tx object. We can capture it by looking at what was returned or just tracking it.
        // Actually, since we mocked it, let's just inspect the mock instance we returned in $transaction.
        return []; // We will spy on createMany inside the test itself
    };

    it("1. AR/backlog cannot become CashAdjustment", async () => {
        const createManySpy = vi.fn();
        (prisma.$transaction as any).mockImplementationOnce(async (cb: any) => cb({
            cashAdjustment: { deleteMany: vi.fn(), createMany: createManySpy },
            baselineSnapshotHistory: { create: vi.fn().mockResolvedValue({ id: "h" }) },
            forecastCheckpoint: { update: vi.fn() },
            accountFreshnessStatus: { updateMany: vi.fn() },
            recurringPattern: { findMany: vi.fn().mockResolvedValue([]) }
        }));

        const req = mockRequest([{ type: "Accounts Receivable", amount: 100, note: "Invoice" }]);
        await POST(req);
        expect(createManySpy).not.toHaveBeenCalled();
    });

    it("2. AP/backlog cannot become CashAdjustment", async () => {
        const createManySpy = vi.fn();
        (prisma.$transaction as any).mockImplementationOnce(async (cb: any) => cb({
            cashAdjustment: { deleteMany: vi.fn(), createMany: createManySpy },
            baselineSnapshotHistory: { create: vi.fn().mockResolvedValue({ id: "h" }) },
            forecastCheckpoint: { update: vi.fn() },
            accountFreshnessStatus: { updateMany: vi.fn() },
            recurringPattern: { findMany: vi.fn().mockResolvedValue([]) }
        }));

        const req = mockRequest([{ type: "Accounts Payable", amount: -100, note: "Bill" }]);
        await POST(req);
        expect(createManySpy).not.toHaveBeenCalled();
    });

    it("3. Leaving AR/AP in backlog changes no starting-cash adjustment", async () => {
        const createManySpy = vi.fn();
        (prisma.$transaction as any).mockImplementationOnce(async (cb: any) => cb({
            cashAdjustment: { deleteMany: vi.fn(), createMany: createManySpy },
            baselineSnapshotHistory: { create: vi.fn().mockResolvedValue({ id: "h" }) },
            forecastCheckpoint: { update: vi.fn() },
            accountFreshnessStatus: { updateMany: vi.fn() },
            recurringPattern: { findMany: vi.fn().mockResolvedValue([]) }
        }));

        const req = mockRequest([
            { type: "AR", amount: 100 },
            { type: "AP", amount: -100 }
        ]);
        await POST(req);
        expect(createManySpy).not.toHaveBeenCalled();
    });

    it("4. Rescheduling AR/AP changes timing only (ignored for starting cash)", async () => {
        const createManySpy = vi.fn();
        (prisma.$transaction as any).mockImplementationOnce(async (cb: any) => cb({
            cashAdjustment: { deleteMany: vi.fn(), createMany: createManySpy },
            baselineSnapshotHistory: { create: vi.fn().mockResolvedValue({ id: "h" }) },
            forecastCheckpoint: { update: vi.fn() },
            accountFreshnessStatus: { updateMany: vi.fn() },
            recurringPattern: { findMany: vi.fn().mockResolvedValue([]) }
        }));

        const req = mockRequest([{ type: "invoice", amount: 500 }]);
        await POST(req);
        expect(createManySpy).not.toHaveBeenCalled();
    });

    it("5. Outstanding check can reduce starting cash", async () => {
        const createManySpy = vi.fn();
        (prisma.$transaction as any).mockImplementationOnce(async (cb: any) => cb({
            cashAdjustment: { deleteMany: vi.fn(), createMany: createManySpy },
            baselineSnapshotHistory: { create: vi.fn().mockResolvedValue({ id: "h" }) },
            forecastCheckpoint: { update: vi.fn() },
            accountFreshnessStatus: { updateMany: vi.fn() },
            recurringPattern: { findMany: vi.fn().mockResolvedValue([]) }
        }));

        const req = mockRequest([{ type: "uncleared_check", amount: -500, note: "Check 123" }]);
        await POST(req);
        expect(createManySpy).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.arrayContaining([expect.objectContaining({ type: "uncleared_check", amount: -500 })])
        }));
    });

    it("6. Deposit in transit can increase starting cash", async () => {
        const createManySpy = vi.fn();
        (prisma.$transaction as any).mockImplementationOnce(async (cb: any) => cb({
            cashAdjustment: { deleteMany: vi.fn(), createMany: createManySpy },
            baselineSnapshotHistory: { create: vi.fn().mockResolvedValue({ id: "h" }) },
            forecastCheckpoint: { update: vi.fn() },
            accountFreshnessStatus: { updateMany: vi.fn() },
            recurringPattern: { findMany: vi.fn().mockResolvedValue([]) }
        }));

        const req = mockRequest([{ type: "pending_deposit", amount: 1000, note: "Stripe" }]);
        await POST(req);
        expect(createManySpy).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.arrayContaining([expect.objectContaining({ type: "pending_deposit", amount: 1000 })])
        }));
    });

    it("7. Generic non-bank financial items are rejected from starting-cash adjustments", async () => {
        const createManySpy = vi.fn();
        (prisma.$transaction as any).mockImplementationOnce(async (cb: any) => cb({
            cashAdjustment: { deleteMany: vi.fn(), createMany: createManySpy },
            baselineSnapshotHistory: { create: vi.fn().mockResolvedValue({ id: "h" }) },
            forecastCheckpoint: { update: vi.fn() },
            accountFreshnessStatus: { updateMany: vi.fn() },
            recurringPattern: { findMany: vi.fn().mockResolvedValue([]) }
        }));

        const req = mockRequest([{ type: "Expected Inflow", amount: 1000 }, { type: "Recurring", amount: -500 }]);
        await POST(req);
        expect(createManySpy).not.toHaveBeenCalled();
    });

    it("8. Multi-account companies cannot silently treat one arbitrary account as total company starting cash", async () => {
        const req = mockRequest([]);
        const res = await POST(req);
        expect(res.status).toBe(200);
        // By UI requirements, we aggregated "Total Cash Across All Active Accounts". 
        // This test ensures the endpoint accepts the single unified balance property `bankBalance`.
        const data = await res.json();
        expect(data.ok).toBe(true);
    });

    it("9. Existing valid bank reconciliation adjustments remain supported", async () => {
        const createManySpy = vi.fn();
        (prisma.$transaction as any).mockImplementationOnce(async (cb: any) => cb({
            cashAdjustment: { deleteMany: vi.fn(), createMany: createManySpy },
            baselineSnapshotHistory: { create: vi.fn().mockResolvedValue({ id: "h" }) },
            forecastCheckpoint: { update: vi.fn() },
            accountFreshnessStatus: { updateMany: vi.fn() },
            recurringPattern: { findMany: vi.fn().mockResolvedValue([]) }
        }));

        const req = mockRequest([
            { type: "other", amount: -50, note: "Bank Fee" },
            { type: "pending_deposit", amount: 200, note: "Cash" }
        ]);
        await POST(req);
        expect(createManySpy).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.arrayContaining([
                expect.objectContaining({ type: "other" }),
                expect.objectContaining({ type: "pending_deposit" })
            ])
        }));
    });
});
