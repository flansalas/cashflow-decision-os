import "dotenv/config";
import { Module } from "module";
import { NextRequest } from "next/server";
import prisma from "../src/db/prisma";

// 1. Setup global mock state
const mockState = {
    userId: null as string | null,
    tenantId: null as string | null
};

// 2. Intercept Node's module loading to mock Clerk & resolveTenant dynamically
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
    if (id === "@clerk/nextjs/server") {
        return {
            auth: async () => {
                return { userId: mockState.userId };
            }
        };
    }
    if (id.endsWith("lib/tenant") || id.includes("lib/tenant")) {
        return {
            resolveTenant: async () => {
                return mockState.tenantId;
            }
        };
    }
    return originalRequire.apply(this, arguments as any);
};

// 3. Now require the route handlers AFTER setting up the require interceptor
const { GET: getDashboard } = require("../src/app/api/dashboard/route");
const { GET: getReview } = require("../src/app/api/review/route");

async function runTests() {
    console.log("=== Running Slice 5A Verification (Approved Plan vs Live Forecast) ===");

    const prefix = "test5a-" + Date.now();
    const tenantIdStd = `${prefix}-std`;
    const tenantIdFrozen = `${prefix}-frozen`;
    const tenantIdDistinct = `${prefix}-distinct`;
    const tenantIdMissing = `${prefix}-missing`;
    const tenantIdMalformed = `${prefix}-malformed`;

    const allTenants = [tenantIdStd, tenantIdFrozen, tenantIdDistinct, tenantIdMissing, tenantIdMalformed];

    // Create current week date
    const d = new Date();
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    const currentWeekStart = new Date(d.toISOString().slice(0, 10));
    
    // Create historical week date (1 week ago)
    const priorWeekStart = new Date(currentWeekStart);
    priorWeekStart.setDate(priorWeekStart.getDate() - 7);

    let passed = 0;
    let failed = 0;

    function assert(condition: boolean, msg: string) {
        if (condition) {
            console.log(`✅ PASS: ${msg}`);
            passed++;
        } else {
            console.error(`❌ FAIL: ${msg}`);
            failed++;
        }
    }

    try {
        // --- 1. Standard Scenario ---
        console.log("\n--- Scenario 1: Standard Plan Loading and Matching ---");
        await prisma.company.create({ data: { id: tenantIdStd, name: "Slice 5A Standard Co" } });
        await prisma.cashSnapshot.create({
            data: {
                id: `snap-std-${prefix}`,
                companyId: tenantIdStd,
                asOfDate: currentWeekStart,
                bankBalance: 10000
            }
        });

        const mockForecastJson = {
            weeks: [
                {
                    weekStart: currentWeekStart.toISOString(),
                    startCash: 10000,
                    inflowsExpected: 5000,
                    outflowsExpected: 2000,
                    endCashExpected: 13000
                },
                {
                    weekStart: priorWeekStart.toISOString(),
                    startCash: 8000,
                    inflowsExpected: 3000,
                    outflowsExpected: 1000,
                    endCashExpected: 10000
                }
            ]
        };

        await prisma.executionPlan.create({
            data: {
                id: `plan-act-std-${prefix}`,
                companyId: tenantIdStd,
                weekStart: currentWeekStart,
                version: 1,
                status: "approved",
                forecastStateJson: JSON.stringify(mockForecastJson)
            }
        });

        await prisma.executionPlan.create({
            data: {
                id: `plan-hist-std-${prefix}`,
                companyId: tenantIdStd,
                weekStart: priorWeekStart,
                version: 1,
                status: "approved",
                reviewedAt: new Date(),
                forecastStateJson: JSON.stringify(mockForecastJson)
            }
        });

        mockState.userId = "user-123";
        mockState.tenantId = tenantIdStd;

        const reqDash = new NextRequest("http://localhost/api/dashboard");
        const resDash = await getDashboard(reqDash);
        const dashData = await resDash.json();

        assert(resDash.status === 200, "Dashboard API returned 200");
        assert(dashData.executionPlan?.planForecast?.weeks?.length === 2, "Dashboard returned active executionPlan with weeks");

        const reqReview = new NextRequest("http://localhost/api/review");
        const resReview = await getReview(reqReview);
        const revData = await resReview.json();

        assert(resReview.status === 200, "Review API returned 200");
        assert(revData.active?.originalPlan?.forecastStateJson?.weekStart === currentWeekStart.toISOString(), "Active originalPlan matches current week");
        
        const histPlan = revData.historical.find((h: any) => h.weekStart === priorWeekStart.toISOString());
        assert(histPlan !== undefined, "Historical review found for prior week");
        assert(histPlan?.originalPlan?.forecastStateJson?.weekStart === priorWeekStart.toISOString(), "Historical originalPlan matches prior week");

        // --- 2. Frozen Approved Plan vs Differing Live Forecast ---
        console.log("\n--- Scenario 2: Approved Plan Remains Frozen when Live Forecast Differs ---");
        await prisma.company.create({ data: { id: tenantIdFrozen, name: "Slice 5A Frozen Co" } });
        await prisma.cashSnapshot.create({
            data: {
                id: `snap-frozen-${prefix}`,
                companyId: tenantIdFrozen,
                asOfDate: currentWeekStart,
                bankBalance: 10000
            }
        });

        await prisma.cashAdjustment.create({
            data: {
                id: `adj-frozen-${prefix}`,
                companyId: tenantIdFrozen,
                type: "other",
                amount: 5000,
                note: "Unplanned incoming cash",
                effectiveDate: currentWeekStart
            }
        });

        // The approved plan is frozen at 13000 ending cash
        await prisma.executionPlan.create({
            data: {
                id: `plan-frozen-${prefix}`,
                companyId: tenantIdFrozen,
                weekStart: currentWeekStart,
                version: 1,
                status: "approved",
                forecastStateJson: JSON.stringify(mockForecastJson)
            }
        });

        mockState.tenantId = tenantIdFrozen;
        const resDashFrozen = await getDashboard(new NextRequest("http://localhost/api/dashboard"));
        const dashDataFrozen = await resDashFrozen.json();

        assert(resDashFrozen.status === 200, "Dashboard API returned 200 for frozen test");
        const approvedEndCash = dashDataFrozen.executionPlan?.planForecast?.weeks?.[0]?.endCashExpected;
        const liveEndCash = dashDataFrozen.forecast?.weeks?.[0]?.endCashExpected;

        assert(approvedEndCash === 13000, `Approved plan expected end cash remains frozen at 13000 (Got: ${approvedEndCash})`);
        assert(liveEndCash !== 13000, `Live forecast end cash is recalculated and differs from frozen plan (Got: ${liveEndCash})`);

        // --- 3. Original vs Revised Plans are Distinct ---
        console.log("\n--- Scenario 3: Original and Revised Plans Remain Distinct ---");
        await prisma.company.create({ data: { id: tenantIdDistinct, name: "Slice 5A Distinct Co" } });
        await prisma.cashSnapshot.create({
            data: {
                id: `snap-distinct-${prefix}`,
                companyId: tenantIdDistinct,
                asOfDate: currentWeekStart,
                bankBalance: 10000
            }
        });

        const mockJsonOriginal = {
            weeks: [{
                weekStart: currentWeekStart.toISOString(),
                endCashExpected: 13000
            }]
        };

        const mockJsonRevised = {
            weeks: [{
                weekStart: currentWeekStart.toISOString(),
                endCashExpected: 14500
            }]
        };

        // Create version 1 (Original)
        await prisma.executionPlan.create({
            data: {
                id: `plan-orig-${prefix}`,
                companyId: tenantIdDistinct,
                weekStart: currentWeekStart,
                version: 1,
                status: "approved",
                forecastStateJson: JSON.stringify(mockJsonOriginal)
            }
        });

        // Create version 2 (Revised)
        await prisma.executionPlan.create({
            data: {
                id: `plan-rev-${prefix}`,
                companyId: tenantIdDistinct,
                weekStart: currentWeekStart,
                version: 2,
                status: "approved",
                forecastStateJson: JSON.stringify(mockJsonRevised)
            }
        });

        mockState.tenantId = tenantIdDistinct;
        const resReviewDistinct = await getReview(new NextRequest("http://localhost/api/review"));
        const revDataDistinct = await resReviewDistinct.json();

        assert(resReviewDistinct.status === 200, "Review API returned 200 for distinct test");
        const origVal = revDataDistinct.active?.originalPlan?.forecastStateJson?.endCashExpected;
        const revVal = revDataDistinct.active?.revisedPlan?.forecastStateJson?.endCashExpected;

        assert(origVal === 13000, `Original Plan returns correct frozen value 13000 (Got: ${origVal})`);
        assert(revVal === 14500, `Revised Plan returns correct frozen value 14500 (Got: ${revVal})`);

        // --- 4. Missing forecastStateJson ---
        console.log("\n--- Scenario 4: Missing forecastStateJson Returns Null Safely ---");
        await prisma.company.create({ data: { id: tenantIdMissing, name: "Slice 5A Missing Co" } });
        await prisma.cashSnapshot.create({
            data: {
                id: `snap-missing-${prefix}`,
                companyId: tenantIdMissing,
                asOfDate: currentWeekStart,
                bankBalance: 10000
            }
        });

        await prisma.executionPlan.create({
            data: {
                id: `plan-missing-${prefix}`,
                companyId: tenantIdMissing,
                weekStart: currentWeekStart,
                version: 1,
                status: "approved",
                forecastStateJson: null // Explicitly null
            }
        });

        mockState.tenantId = tenantIdMissing;

        // Test Dashboard
        const resDashMissing = await getDashboard(new NextRequest("http://localhost/api/dashboard"));
        const dashDataMissing = await resDashMissing.json();
        assert(resDashMissing.status === 200, "Dashboard API returned 200 with missing JSON");
        assert(dashDataMissing.executionPlan?.planForecast === null, "Dashboard returns null planForecast");

        // Test Review
        const resReviewMissing = await getReview(new NextRequest("http://localhost/api/review"));
        const revDataMissing = await resReviewMissing.json();
        assert(resReviewMissing.status === 200, "Review API returned 200 with missing JSON");
        assert(revDataMissing.active?.originalPlan?.forecastStateJson === null, "Review returns null forecastStateJson");

        // --- 5. Malformed forecastStateJson ---
        console.log("\n--- Scenario 5: Malformed forecastStateJson Returns Null Safely ---");
        await prisma.company.create({ data: { id: tenantIdMalformed, name: "Slice 5A Malformed Co" } });
        await prisma.cashSnapshot.create({
            data: {
                id: `snap-malformed-${prefix}`,
                companyId: tenantIdMalformed,
                asOfDate: currentWeekStart,
                bankBalance: 10000
            }
        });

        await prisma.executionPlan.create({
            data: {
                id: `plan-malformed-${prefix}`,
                companyId: tenantIdMalformed,
                weekStart: currentWeekStart,
                version: 1,
                status: "approved",
                forecastStateJson: "{ malformed json structure: true, " // Invalid JSON syntax
            }
        });

        mockState.tenantId = tenantIdMalformed;

        // Test Dashboard
        const resDashMalformed = await getDashboard(new NextRequest("http://localhost/api/dashboard"));
        const dashDataMalformed = await resDashMalformed.json();
        assert(resDashMalformed.status === 200, "Dashboard API returned 200 with malformed JSON");
        assert(dashDataMalformed.executionPlan?.planForecast === null, "Dashboard returns null planForecast for malformed JSON");

        // Test Review
        const resReviewMalformed = await getReview(new NextRequest("http://localhost/api/review"));
        const revDataMalformed = await resReviewMalformed.json();
        assert(resReviewMalformed.status === 200, "Review API returned 200 with malformed JSON");
        assert(revDataMalformed.active?.originalPlan?.forecastStateJson === null, "Review returns null forecastStateJson for malformed JSON");

        console.log(`\nAll Scenarios finished. Passed: ${passed}, Failed: ${failed}`);
        if (failed > 0) process.exit(1);
        else process.exit(0);

    } finally {
        console.log("\nCleaning up verification records...");
        for (const tId of allTenants) {
            await prisma.cashAdjustment.deleteMany({ where: { companyId: tId } });
            await prisma.executionPlan.deleteMany({ where: { companyId: tId } });
            await prisma.cashSnapshot.deleteMany({ where: { companyId: tId } });
            await prisma.company.deleteMany({ where: { id: tId } });
        }
        console.log("Cleanup complete.");
    }
}

runTests().catch(e => {
    console.error("Crash in verification script:", e);
    process.exit(1);
});
