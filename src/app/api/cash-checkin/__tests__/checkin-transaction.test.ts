import "dotenv/config";
import { POST } from '../route';
import { NextRequest } from 'next/server';
import { vi, test, expect, afterAll } from 'vitest';
import prisma from '@/db/prisma';

vi.mock('@/lib/tenant', () => ({
    resolveTenant: vi.fn(async () => "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb")
}));

test('cash-checkin API transaction integration', async () => {
    const companyId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb";
    
    // Ensure BaselineSnapshot exists for the test
    try {
        await prisma.baselineSnapshot.upsert({
            where: { companyId },
            update: {},
            create: {
                id: crypto.randomUUID(),
                companyId,
                asOfDate: new Date(),
                variableInflowWeekly: 1000,
                variableOutflowWeekly: 500,
                variableInflowBand: 0.1,
                variableOutflowBand: 0.1,
                inflowCadence: "weekly",
                outflowCadence: "weekly",
                baselineConfidenceTier: "high",
                hasSufficientHistory: true
            }
        });
    } catch (e: any) {
        console.error("PRISMA ERROR CODE:", e.code);
        console.error("PRISMA ERROR META:", e.meta);
        console.error("PRISMA ERROR MESSAGE:", e.message);
        throw e;
    }

    const req = new NextRequest("http://localhost/api/cash-checkin", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            companyId: "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb",
            bankBalance: 12345.67,
            asOfDate: new Date().toISOString(),
            adjustments: [],
            bankDataMissing: false,
            priorWeekForecast: {
                forecastVersionHash: "client_observed_v1",
                generatedAt: new Date().toISOString(),
                weekStart: "2026-08-02T00:00:00Z",
                weekEnd: "2026-08-08T23:59:59Z",
                endCashExpected: 50000,
                inflowsExpected: 1000,
                outflowsExpected: 500
            }
        })
    });

    const res = await POST(req);
    const body = await res.json();
    
    if (res.status === 500) {
        console.error("Test failed with 500.");
        console.error("Error Message:", body.error);
        if (body.details) console.error("Error Details:", JSON.stringify(body.details, null, 2));
    }
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    
    const checkpointId = body.checkpoint.id;
    expect(checkpointId).toBeDefined();

    // 1. Verify ForecastCheckpoint is created with correct properties
    const checkpoint = await prisma.forecastCheckpoint.findUnique({
        where: { id: checkpointId }
    });
    expect(checkpoint).toBeDefined();
    expect(checkpoint!.snapshotSource).toBe("client_observed_unverified");
    expect(checkpoint!.isBankCoverageVerified).toBe(false);

    // Verify the prior week forecast was sealed
    const sealedCheckpoint = await prisma.forecastCheckpoint.findFirst({
        where: { companyId: "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb", snapshotSource: "sealed_v1" }
    });
    expect(sealedCheckpoint).toBeDefined();
    expect(sealedCheckpoint!.forecastVersionHash.length).toBeGreaterThan(10);

    // 2. Verify BaselineSnapshotHistory is created
    const bsh = await prisma.baselineSnapshotHistory.findUnique({
        where: { forecastCheckpointId: checkpointId }
    });
    expect(bsh).toBeDefined();
    expect(bsh!.companyId).toBe("bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb");

    // 3. Verify AccountFreshnessStatus references the correct baseline history ID
    const freshness = await prisma.accountFreshnessStatus.findFirst({
        where: { checkpointId: bsh!.id }
    });
    expect(freshness).toBeDefined();
}, 30000);

afterAll(async () => {
    await prisma.$disconnect();
});
