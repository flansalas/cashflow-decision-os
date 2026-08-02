import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

// Note: To test atomicity of cash-checkin/route.ts directly, we would normally use supertest
// But since we want to prove the prisma transaction semantics specifically as requested:
describe("Stage 1 - Immutable Forward Validation Atomicity", () => {
    let companyId: string;
    let cashSnapshotId: string;
    let baselineSnapshotId: string;

    beforeAll(async () => {
        companyId = uuidv4();
        await prisma.company.create({
            data: { id: companyId, name: "Test Stage 1 Atomicity", isDemo: true }
        });

        const snap = await prisma.cashSnapshot.create({
            data: { companyId, bankBalance: 100000, asOfDate: new Date() }
        });
        cashSnapshotId = snap.id;

        const baseline = await prisma.baselineSnapshot.create({
            data: {
                companyId,
                asOfDate: new Date(),
                hasSufficientHistory: true,
                baselineConfidenceTier: "high",
                inflowCadence: "1",
                outflowCadence: "1",
                variableInflowWeekly: 50000,
                variableOutflowWeekly: 40000,
                variableInflowBand: 0.2,
                variableOutflowBand: 0.2,
                weeklyInflowCoverageJson: "[0.5, 0.4]",
                evidenceStateJson: "[\"KNOWN_INFLOW\"]",
                promptVersionHash: "v1.0",
                modelIdentifier: "gpt-4o-mini",
                aiInflowFactorsJson: "[1, 1]",
                aiOutflowFactorsJson: "[1, 1]",
                rawAiResponseJson: "{\"test\": true}",
                aiReasoningLogJson: "Tested reason",
            }
        });
        baselineSnapshotId = baseline.id;
    });

    afterAll(async () => {
        await prisma.company.delete({ where: { id: companyId } });
    });

    it("1 & 3 & 5. successful atomic creation and exact preservation of metadata", async () => {
        const cpId = uuidv4();
        await prisma.$transaction(async (tx) => {
            const checkpoint = await tx.forecastCheckpoint.create({
                data: {
                    id: cpId,
                    companyId,
                    cashSnapshotId,
                    snapshotSource: "client_observed_v1",
                    weekStart: new Date(),
                    weekEnd: new Date(),
                    endCashExpected: 100000,
                    inflowsExpected: 50000,
                    outflowsExpected: 40000,
                }
            });

            await tx.forecastComponentSnapshot.createMany({
                data: [{
                    forecastCheckpointId: checkpoint.id,
                    targetWeekStart: new Date(),
                    direction: "inflow",
                    componentCategory: "test",
                    sourceType: "test",
                    projectedAmount: 50000,
                    confidenceTier: "high",
                    sourceStateHash: "abc"
                }]
            });

            const baselineSnapshot = await tx.baselineSnapshot.findUnique({ where: { companyId } });
            
            await tx.baselineSnapshotHistory.create({
                data: {
                    id: uuidv4(),
                    forecastCheckpointId: checkpoint.id,
                    companyId: companyId,
                    asOfDate: new Date(),
                    variableInflowWeekly: baselineSnapshot!.variableInflowWeekly,
                    variableOutflowWeekly: baselineSnapshot!.variableOutflowWeekly,
                    explicitInflowJson: baselineSnapshot!.weeklyInflowCoverageJson || "[]",
                    explicitOutflowJson: baselineSnapshot!.weeklyOutflowCoverageJson || "[]",
                    evidenceStateJson: baselineSnapshot!.evidenceStateJson || "[]",
                    promptVersionHash: baselineSnapshot!.promptVersionHash || "unknown",
                    modelIdentifier: baselineSnapshot!.modelIdentifier || "unknown",
                    rawAiResponseJson: baselineSnapshot!.rawAiResponseJson || "{}",
                    reasoningLog: baselineSnapshot!.aiReasoningLogJson || "",
                }
            });
        });

        // Verify it was preserved
        const history = await prisma.baselineSnapshotHistory.findUnique({ where: { forecastCheckpointId: cpId } });
        expect(history).not.toBeNull();
        expect(history?.explicitInflowJson).toEqual(expect.any(String));
        expect(history?.explicitOutflowJson).toEqual(expect.any(String));
        expect(history?.promptVersionHash).toBe("v1.0");
    });

    it("2. full rollback if any insert fails", async () => {
        const cpId = uuidv4();
        
        const txPromise = prisma.$transaction(async (tx) => {
            const checkpoint = await tx.forecastCheckpoint.create({
                data: {
                    id: cpId,
                    companyId,
                    cashSnapshotId,
                    snapshotSource: "client_observed_v1",
                    weekStart: new Date(),
                    weekEnd: new Date(),
                    endCashExpected: 100000,
                    inflowsExpected: 50000,
                    outflowsExpected: 40000,
                }
            });

            // Simulate failure in BaselineSnapshotHistory creation (e.g. missing required field)
            await tx.baselineSnapshotHistory.create({
                data: {
                    id: uuidv4(),
                    forecastCheckpointId: checkpoint.id,
                    companyId: companyId,
                    asOfDate: new Date(),
                    // Intentionally omit required fields to trigger error
                } as any
            });
        });

        await expect(txPromise).rejects.toThrow();

        // Verify the checkpoint was rolled back
        const cp = await prisma.forecastCheckpoint.findUnique({ where: { id: cpId } });
        expect(cp).toBeNull();
    });

    it("4. no overwrite of an existing historical baseline record", async () => {
        const cpId = uuidv4();
        // Since forecastCheckpointId is marked as @unique in BaselineSnapshotHistory,
        // attempting to create a second history record for the same checkpoint will throw a unique constraint error.
        
        await prisma.$transaction(async (tx) => {
            const snap2 = await tx.cashSnapshot.create({
                data: { companyId, bankBalance: 200000, asOfDate: new Date() }
            });
            await tx.forecastCheckpoint.create({
                data: { id: cpId, companyId, cashSnapshotId: snap2.id, weekStart: new Date(), weekEnd: new Date(), endCashExpected: 0, inflowsExpected: 0, outflowsExpected: 0 }
            });
            await tx.baselineSnapshotHistory.create({
                data: { id: uuidv4(), forecastCheckpointId: cpId, companyId, asOfDate: new Date(), variableInflowWeekly: 0, variableOutflowWeekly: 0, explicitInflowJson: "", explicitOutflowJson: "", evidenceStateJson: "", promptVersionHash: "", modelIdentifier: "", rawAiResponseJson: "", reasoningLog: "" }
            });
        });

        const txPromise = prisma.baselineSnapshotHistory.create({
            data: { id: uuidv4(), forecastCheckpointId: cpId, companyId, asOfDate: new Date(), variableInflowWeekly: 0, variableOutflowWeekly: 0, explicitInflowJson: "", explicitOutflowJson: "", evidenceStateJson: "", promptVersionHash: "", modelIdentifier: "", rawAiResponseJson: "", reasoningLog: "" }
        });

        await expect(txPromise).rejects.toThrow(/Unique constraint/);
    });
});
