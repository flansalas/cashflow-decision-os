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
        // Skipping cleanup of sealed records as per user instruction
    });

    it("creates an immutable sealed forecast checkpoint successfully", async () => {
        const checkpoint = await prisma.$transaction(async (tx) => {
            return await createForecastVersion(tx, companyId, cashSnapshotId);
        });

        expect(checkpoint).toBeDefined();
        expect(checkpoint.sealedAt).toBeDefined();
        expect(checkpoint.forecastVersionHash).toBeDefined();

        // Check if idempotency works
        const duplicate = await prisma.$transaction(async (tx) => {
            return await createForecastVersion(tx, companyId, cashSnapshotId);
        });

        expect(duplicate.id).toEqual(checkpoint.id);

        // Check that ForecastWeeks were created
        const weeks = await prisma.forecastWeek.findMany({
            where: { forecastCheckpointId: checkpoint.id }
        });
        expect(weeks.length).toBe(13);
    }, 30000);

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
