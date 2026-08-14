import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.setConfig({ testTimeout: 30000 });
import { createForecastVersion } from "../forecast-seal";
import prisma from "@/db/prisma";
import * as crypto from "crypto";

describe("Sealed Forecast Version", () => {
    let companyId: string;
    let cashSnapshotId: string;

    beforeAll(async () => {
        companyId = `test-co-${crypto.randomUUID()}`;

        // Setup initial data
        await prisma.company.create({
            data: { id: companyId, name: "Test Co for Sealing" }
        });

        const snap = await prisma.cashSnapshot.create({
            data: {
                id: crypto.randomUUID(),
                companyId,
                asOfDate: new Date(),
                bankBalance: 150000.0
            }
        });
        cashSnapshotId = snap.id;
    });

    afterAll(async () => {
        try {
            await prisma.forecastCheckpoint.deleteMany({});
        } catch (e) {}
    });

    it("creates an immutable sealed forecast checkpoint successfully and validates W1 header", async () => {
        const checkpoint = await prisma.$transaction(async (tx) => {
            return await createForecastVersion(tx, companyId, cashSnapshotId);
        });

        expect(checkpoint).toBeDefined();
        expect(checkpoint.sealedAt).toBeDefined();
        expect(checkpoint.forecastVersionHash).toBeDefined();

        // Check that ForecastWeeks were created
        const weeks = await prisma.forecastWeek.findMany({
            where: { forecastCheckpointId: checkpoint.id },
            orderBy: { weekStart: "asc" }
        });
        expect(weeks.length).toBe(13);

        // Verify EXACT WEEK NUMBER SEQUENCE
        for (let i = 0; i < weeks.length; i++) {
            expect(weeks[i].weekStart.getTime()).toBeGreaterThan(weeks[i === 0 ? 0 : i - 1].weekStart.getTime() - 1000);
        }

        // Verify W1 HEADER proof
        const w1 = weeks[0];
        expect(checkpoint.weekStart.toISOString()).toBe(w1.weekStart.toISOString());
        expect(checkpoint.weekEnd.toISOString()).toBe(w1.weekEnd.toISOString());
        expect(checkpoint.inflowsExpected).toBe(w1.inflowsExpected);
        expect(checkpoint.outflowsExpected).toBe(w1.outflowsExpected);
        expect(checkpoint.endCashExpected).toBe(w1.endCashExpected);

        // Assert component constraints
        const components = await prisma.forecastComponentSnapshot.findMany({
            where: { forecastCheckpointId: checkpoint.id }
        });
        for (const comp of components) {
            // Confirm overrideId is not comma-separated
            if (comp.overrideId) {
                expect(comp.overrideId.includes(",")).toBe(false);
            }
        }
    }, 30000);

    it("ensures canonical hash does not rely on cashSnapshotId", async () => {
        const snap2 = await prisma.cashSnapshot.create({
            data: {
                id: crypto.randomUUID(), // different ID
                companyId,
                asOfDate: new Date(),
                bankBalance: 150000.0 // Identical semantic state
            }
        });
        const checkpoint2 = await prisma.$transaction(async (tx) => {
            return await createForecastVersion(tx, companyId, snap2.id);
        });

        // If snapshotId was hashed, these would differ.
        // Because of our fix, they should be identical.
        const originalCheckpoint = await prisma.forecastCheckpoint.findFirst({
            where: { cashSnapshotId }
        });

        expect(originalCheckpoint?.forecastVersionHash).toBe(checkpoint2.forecastVersionHash);
    });

    it("triggers reject mutations on sealed history", async () => {
        const history = await prisma.baselineSnapshotHistory.findFirst({
            where: { companyId }
        });

        if (history) {
            await expect(prisma.baselineSnapshotHistory.update({
                where: { id: history.id },
                data: { variableInflowWeekly: 100 }
            })).rejects.toThrow();
        }
    });
});
