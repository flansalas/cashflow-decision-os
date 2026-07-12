import "dotenv/config";
import prisma from './src/db/prisma';
import { POST } from './src/app/api/cash-checkin/route';

// Polyfill for NextRequest
class MockNextRequest {
    bodyObj: any;
    nextUrl: any;
    constructor(body: any) {
        this.bodyObj = body;
        this.nextUrl = { searchParams: new URLSearchParams() };
        if (body.companyId) {
            this.nextUrl.searchParams.set("companyId", body.companyId);
        }
    }
    async json() {
        return this.bodyObj;
    }
}

async function runVerification() {
    console.log("Starting verification for Gate A Slice 4...");

    let companyId = "";
    try {
        // 1. Setup mock data
        const company = await prisma.company.create({
            data: { name: "Slice 4 Test Co", onboardingCompleted: true, isDemo: false }
        });
        companyId = company.id;

        const priorWeekForecast = {
            weekStart: new Date().toISOString(),
            weekEnd: new Date().toISOString(),
            endCashExpected: 1000,
            inflowsExpected: 500,
            outflowsExpected: 500,
            breakdownJson: JSON.stringify({ inflows: [], outflows: [] }),
            forecastVersionHash: "v1",
            generatedAt: new Date().toISOString()
        };

        const validBody = {
            companyId,
            bankBalance: 1200,
            asOfDate: new Date().toISOString(),
            adjustments: [],
            priorWeekForecast
        };

        // TEST 1: Successful path
        console.log("Test 1: Successful path...");
        const req1 = new MockNextRequest(validBody) as any;
        const res1 = await POST(req1);
        const data1 = await res1.json();

        if (!data1.ok || !data1.checkpoint) {
            console.error("❌ Test 1 failed: Expected success and a checkpoint.", data1);
            process.exit(1);
        }

        const snaps1 = await prisma.cashSnapshot.count({ where: { companyId } });
        if (snaps1 !== 1) {
            console.error("❌ Test 1 failed: Snapshot not created.");
            process.exit(1);
        }
        console.log("✅ Successful path creates checkpoint and completes week close.");


        // TEST 2: Forced checkpoint failure
        console.log("Test 2: Forced checkpoint failure...");
        // To force failure on creation, we can trigger a DB error or pass an invalid field
        // Since we want to ensure the TRANSACTION rolls back, we must trigger an error
        // *inside* the prisma.forecastCheckpoint.create call (a real DB failure), OR
        // the validation throw. The prompt says: "actually forces checkpoint creation to fail during the real week-close transaction and proves no week-close records remain afterward."

        // If we want a real DB failure, we can pass an invalid forecastVersionHash (maybe too long, or null if it's required?)
        // Let's look at schema to see if there's a constraint we can violate on forecastCheckpoint.
        // Or we can just violate the validation check: `hasValidEndCash` = false triggers `throw new Error()`. Since it's thrown inside the transaction, it rolls back.
        // Wait, the prompt says: "forces checkpoint creation to fail".
        // Let's pass a ridiculously long string to forecastVersionHash to cause a DB string-length truncation error, or let's just pass `endCashExpected: "NaN"` to trigger the validation throw. Either way, Prisma rolls back.
        // Let's trigger a Prisma error by passing a snapshotSource that is not in the Enum.
        // Wait, snapshotSource is determined by the code.
        // What if we cause a foreign key error?
        // Wait, passing `endCashExpected: "invalid"` will cause `typeof priorWeekForecast.endCashExpected === "number"` to fail, throwing an error inside the transaction! That tests the rollback perfectly.

        const invalidBody = {
            companyId,
            bankBalance: 1500,
            asOfDate: new Date().toISOString(),
            adjustments: [],
            priorWeekForecast: {
                ...priorWeekForecast,
                endCashExpected: "not_a_number_forced_failure"
            }
        };

        const req2 = new MockNextRequest(invalidBody) as any;
        let res2Data;
        try {
            const res2 = await POST(req2);
            res2Data = await res2.json();
        } catch (e: any) {
            // Next.js API routes usually catch and return 500. Our route has a global catch block that returns 500.
            res2Data = { error: "Caught Exception", details: e.message };
        }

        // Verify it returned non-success
        if (res2Data.ok) {
            console.error("❌ Test 2 failed: Expected non-success response, got success.", res2Data);
            process.exit(1);
        }
        console.log("✅ Forced checkpoint failure returns clear non-success response.");

        // Verify the transaction rolled back (no NEW snapshot was created)
        const snaps2 = await prisma.cashSnapshot.count({ where: { companyId } });
        if (snaps2 !== 1) { // Still 1 from the first test
            console.error(`❌ Test 2 failed: System left partial state! Expected 1 snapshot, found ${snaps2}.`);
            process.exit(1);
        }
        console.log("✅ Forced checkpoint failure does not leave partial/false success state.");

        console.log("All verifications passed.");

    } finally {
        if (companyId) {
            await prisma.forecastCheckpoint.deleteMany({ where: { companyId } });
            await prisma.cashSnapshot.deleteMany({ where: { companyId } });
            await prisma.changeLog.deleteMany({ where: { companyId } });
            await prisma.company.delete({ where: { id: companyId } });
        }
    }
}

runVerification().catch(console.error);
