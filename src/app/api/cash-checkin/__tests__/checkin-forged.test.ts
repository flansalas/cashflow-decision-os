import "dotenv/config";
import { POST } from '../route';
import { NextRequest } from 'next/server';
import { vi, test, expect, afterAll } from 'vitest';
import prisma from '@/db/prisma';

vi.mock('@/lib/tenant', () => ({
    resolveTenant: vi.fn(async () => "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb")
}));

test('forged priorWeekForecast does not affect canonical sealed checkpoint', async () => {
    const companyId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb";
    
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
    } catch (e: any) {}

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
                forecastVersionHash: "forged_hash_123",
                generatedAt: new Date().toISOString(),
                weekStart: "2026-08-02T00:00:00Z",
                weekEnd: "2026-08-08T23:59:59Z",
                endCashExpected: 999999999, // FORGED
                inflowsExpected: 999999999, // FORGED
                outflowsExpected: -999999999 // FORGED
            }
        })
    });

    const res = await POST(req);
    const body = await res.json();
    
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    // Verify the unsealed checkpoint was created with forged values
    const unsealedCheckpoint = await prisma.forecastCheckpoint.findFirst({
        where: { companyId, snapshotSource: "browser_v1_legacy" }
    });
    expect(unsealedCheckpoint).toBeDefined();
    expect(unsealedCheckpoint!.endCashExpected).toBe(999999999);

    // Verify the canonical sealed checkpoint exists and is NOT affected by forged values
    const sealedCheckpoint = await prisma.forecastCheckpoint.findFirst({
        where: { companyId, snapshotSource: "server_canonical_v1", sealedAt: { not: null } }
    });
    expect(sealedCheckpoint).toBeDefined();
    
    // The canonical should be computed from the assembly, not the forged client values.
    // 999999999 would mean it was affected.
    expect(sealedCheckpoint!.endCashExpected).not.toBe(999999999);
    expect(sealedCheckpoint!.inflowsExpected).not.toBe(999999999);
    
    // Also confirm the checkpoint schema version
    expect(sealedCheckpoint!.forecastSchemaVersion).toBe(1);
});

afterAll(async () => {
    const companyId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb";
    try {
        await prisma.forecastCheckpoint.deleteMany({});
    } catch(e) {}
    await prisma.forecastWeek.deleteMany({ where: { companyId } });
    await prisma.cashSnapshot.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
});
