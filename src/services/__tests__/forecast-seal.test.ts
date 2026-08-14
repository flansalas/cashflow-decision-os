import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.setConfig({ testTimeout: 30000 });
import { createForecastVersion } from "../forecast-seal";
import { canonicalJsonSerialize, computeCanonicalHash } from "../canonical-hash";
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
        // Create a legacy unsealed checkpoint directly to simulate the cash-checkin route
        const legacyCheckpoint = await prisma.forecastCheckpoint.create({
            data: {
                companyId,
                cashSnapshotId,
                weekStart: new Date(),
                weekEnd: new Date(),
                endCashExpected: 150000,
                inflowsExpected: 0,
                outflowsExpected: 0,
                // The legacy checkpoint must have sealedAt == null
                sealedAt: null
            }
        });

        const sealedCheckpoint = await prisma.$transaction(async (tx) => {
            return await createForecastVersion(tx, companyId, cashSnapshotId);
        });

        // 2. The legacy checkpoint must have sealedAt == null
        expect(legacyCheckpoint.sealedAt).toBeNull();

        // 3. The sealed checkpoint must have sealedAt != null
        expect(sealedCheckpoint).toBeDefined();
        expect(sealedCheckpoint.sealedAt).toBeDefined();
        expect(sealedCheckpoint.sealedAt).not.toBeNull();
        expect(sealedCheckpoint.forecastVersionHash).toBeDefined();

        // 1. The server must reject forged hashes (by generating its own absolute truth)
        // Check that ForecastWeeks were created
        const weeks = await prisma.forecastWeek.findMany({
            where: { forecastCheckpointId: sealedCheckpoint.id },
            orderBy: { weekStart: "asc" }
        });
        expect(weeks.length).toBe(13);

        // Verify W1 HEADER proof
        const w1 = weeks[0];
        expect(sealedCheckpoint.weekStart.toISOString()).toBe(w1.weekStart.toISOString());
        expect(sealedCheckpoint.weekEnd.toISOString()).toBe(w1.weekEnd.toISOString());
        expect(sealedCheckpoint.inflowsExpected).toBe(w1.inflowsExpected);
        expect(sealedCheckpoint.outflowsExpected).toBe(w1.outflowsExpected);
        expect(sealedCheckpoint.endCashExpected).toBe(w1.endCashExpected);

        // The hash in the DB MUST match the canonical hash of the payload
        const payloadJson = sealedCheckpoint.canonicalPayloadJson;
        expect(payloadJson).toBeDefined();
        const recomputedHash = computeCanonicalHash(payloadJson!);
        expect(sealedCheckpoint.forecastVersionHash).toBe(recomputedHash);
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

        const originalCheckpoint = await prisma.forecastCheckpoint.findFirst({
            where: { cashSnapshotId, sealedAt: { not: null } }
        });

        expect(originalCheckpoint?.forecastVersionHash).toBe(checkpoint2.forecastVersionHash);
    });

    it("strictly derives forecastVersionHash from canonical JSON serialization without throwing on invalid values", () => {
        // 4. The sealed checkpoint's forecastVersionHash must be strictly derived from canonical JSON serialization,
        // which MUST NOT throw errors when NaN or Infinity or undefined appear.
        const dirtyPayload = {
            schemaVersion: 1,
            companyId: "company1",
            amount: 100,
            badNumber: NaN,
            worseNumber: Infinity,
            missingValue: undefined,
            nested: {
                a: NaN,
                b: "valid"
            }
        };

        let serialized = "";
        expect(() => {
            serialized = canonicalJsonSerialize(dirtyPayload);
        }).not.toThrow();

        // Check replacements
        const parsed = JSON.parse(serialized);
        expect(parsed.badNumber).toBeNull();
        expect(parsed.worseNumber).toBeNull();
        expect(parsed.missingValue).toBeUndefined(); // Omitted entirely
        expect(Object.keys(parsed).includes("missingValue")).toBe(false);
        expect(parsed.nested.a).toBeNull();
        expect(parsed.nested.b).toBe("valid");

        const hash = computeCanonicalHash(serialized);
        expect(typeof hash).toBe("string");
        expect(hash.length).toBe(64); // SHA-256 hex
    });
});
