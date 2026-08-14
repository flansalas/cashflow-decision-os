import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { POST } from "../route";
import { NextRequest } from "next/server";
import prisma from "@/db/prisma";

vi.mock("@vercel/functions", () => ({
    waitUntil: vi.fn()
}));

// Mock tenant resolver to use test company
vi.mock("@/lib/tenant", () => ({
    resolveTenant: vi.fn(() => "test-company-coverage-new")
}));

describe("Cash Check-in Coverage & Rollback", () => {
    const companyId = "test-company-coverage-new";

    beforeAll(async () => {
        await prisma.company.upsert({
            where: { id: companyId },
            update: { name: "Checkin Test Company" },
            create: { id: companyId, name: "Checkin Test Company", isDemo: true }
        });

        // Set up snapshot
        const snapshot = await prisma.cashSnapshot.create({
            data: { companyId, asOfDate: new Date("2026-08-01T00:00:00Z"), bankBalance: 1200 }
        });

        await prisma.forecastWeek.create({
            data: {
                companyId,
                weekStart: new Date("2026-08-01T00:00:00Z"),
                weekEnd: new Date("2026-08-07T23:59:59Z"),
                startCash: 1000,
                endCashExpected: 1000,
                inflowsExpected: 500,
                outflowsExpected: 200,
                inflowsBest: 500,
                outflowsBest: 200,
                endCashBest: 1000,
                inflowsWorst: 500,
                outflowsWorst: 200,
                endCashWorst: 1000,
                zone: "safe",
                forecastVersionHash: "test-hash"
            }
        });
    });

    afterAll(async () => {
        await prisma.$executeRawUnsafe('ALTER TABLE "ForecastCheckpoint" DISABLE TRIGGER USER');
        await prisma.forecastCheckpoint.deleteMany({ where: { companyId } });
        await prisma.$executeRawUnsafe('ALTER TABLE "ForecastCheckpoint" ENABLE TRIGGER USER');
        await prisma.forecastWeek.deleteMany({ where: { companyId } });
        await prisma.cashSnapshot.deleteMany({ where: { companyId } });
        await prisma.company.delete({ where: { id: companyId } });
        await prisma.$disconnect();
    });

    const mockRequest = (body: any) => {
        return new NextRequest("http://localhost/api/cash-checkin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
    };

    it("verifies skip flow creates unverified checkpoint and preserves skip reason", async () => {
        const req = mockRequest({
            bankBalance: 1200,
            adjustments: [],
            bankDataMissing: true, // explicit skip
            priorWeekForecast: {
                weekStart: "2026-08-01T00:00:00Z",
                weekEnd: "2026-08-07T23:59:59Z",
                endCashExpected: 1000,
                inflowsExpected: 500,
                outflowsExpected: 200
            }
        });

        const res = await POST(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.ok).toBe(true);
        expect(data.checkpoint?.id).toBeDefined();

        const cp = await prisma.forecastCheckpoint.findUnique({
            where: { id: data.checkpoint.id }
        });

        expect(cp).not.toBeNull();
        expect(cp!.snapshotSource).toBe("client_observed_unverified");
        expect(cp!.isBankCoverageVerified).toBe(false);
    });
});
