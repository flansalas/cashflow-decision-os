import "dotenv/config";
import { POST } from '../route';
import { NextRequest } from 'next/server';
import { vi, test, expect, afterAll } from 'vitest';
import prisma from '@/db/prisma';

vi.mock('@/lib/tenant', () => ({
    resolveTenant: vi.fn(async () => "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb")
}));

// Mock createForecastVersion to throw an error
vi.mock('@/services/forecast-seal', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/services/forecast-seal')>();
    return {
        ...actual,
        createForecastVersion: vi.fn().mockImplementation(() => {
            throw new Error("Simulated failure during version sealing");
        })
    };
});

test('cash-checkin rollback on sealing failure', async () => {
    const companyId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb";

    // Count before
    const beforeSnapshots = await prisma.cashSnapshot.count({ where: { companyId } });
    const beforeCheckpoints = await prisma.forecastCheckpoint.count({ where: { companyId } });
    const beforeWeeks = await prisma.forecastWeek.count({ where: { companyId } });
    const beforeCheckpointsList = await prisma.forecastCheckpoint.findMany({ where: { companyId }, select: { id: true } });
    const beforeCheckpointIds = beforeCheckpointsList.map(c => c.id);
    const beforeComponents = await prisma.forecastComponentSnapshot.count({ where: { forecastCheckpointId: { in: beforeCheckpointIds.length ? beforeCheckpointIds : ['none'] } } });
    const beforeBaselineHistory = await prisma.baselineSnapshotHistory.count({ where: { companyId } });
    const beforeChangeLogs = await prisma.changeLog.count({ where: { companyId } });

    const req = new NextRequest("http://localhost/api/cash-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            companyId,
            bankBalance: 99999.99,
            asOfDate: new Date().toISOString(),
            adjustments: [{ id: "fake", amount: 100 }],
            bankDataMissing: false
        })
    });

    const res = await POST(req);
    const body = await res.json();
    
    // The route catches the error and throws it, so it should be a 500 response
    expect(res.status).toBe(500);

    // Count after
    const afterSnapshots = await prisma.cashSnapshot.count({ where: { companyId } });
    const afterCheckpoints = await prisma.forecastCheckpoint.count({ where: { companyId } });
    const afterWeeks = await prisma.forecastWeek.count({ where: { companyId } });
    const afterCheckpointsList = await prisma.forecastCheckpoint.findMany({ where: { companyId }, select: { id: true } });
    const afterCheckpointIds = afterCheckpointsList.map(c => c.id);
    const afterComponents = await prisma.forecastComponentSnapshot.count({ where: { forecastCheckpointId: { in: afterCheckpointIds.length ? afterCheckpointIds : ['none'] } } });
    const afterBaselineHistory = await prisma.baselineSnapshotHistory.count({ where: { companyId } });
    const afterChangeLogs = await prisma.changeLog.count({ where: { companyId } });

    // Assert that NO new artifacts were left behind
    expect(afterSnapshots).toBe(beforeSnapshots);
    expect(afterCheckpoints).toBe(beforeCheckpoints);
    expect(afterWeeks).toBe(beforeWeeks);
    expect(afterComponents).toBe(beforeComponents);
    expect(afterBaselineHistory).toBe(beforeBaselineHistory);
    expect(afterChangeLogs).toBe(beforeChangeLogs);

}, 30000);

afterAll(async () => {
    await prisma.$disconnect();
});
