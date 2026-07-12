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

    const tenantId = "test-company-slice5a-" + Date.now();

    // Create current week date
    const d = new Date();
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    const currentWeekStart = new Date(d.toISOString().slice(0, 10));
    
    // Create historical week date (1 week ago)
    const priorWeekStart = new Date(currentWeekStart);
    priorWeekStart.setDate(priorWeekStart.getDate() - 7);

    try {
        // Setup data
        await prisma.company.create({ data: { id: tenantId, name: "Slice 5A Test Co" } });
        await prisma.cashSnapshot.create({
            data: {
                id: "snap-" + Date.now(),
                companyId: tenantId,
                asOfDate: currentWeekStart,
                bankBalance: 10000
            }
        });

        // 1. Mock JSON payload with 2 weeks of data
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

        // 2. Create Active ExecutionPlan
        await prisma.executionPlan.create({
            data: {
                id: "plan-active-" + Date.now(),
                companyId: tenantId,
                weekStart: currentWeekStart,
                version: 1,
                status: "approved",
                forecastStateJson: JSON.stringify(mockForecastJson)
            }
        });

        // 3. Create Historical ExecutionPlan (for prior week)
        await prisma.executionPlan.create({
            data: {
                id: "plan-hist-" + Date.now(),
                companyId: tenantId,
                weekStart: priorWeekStart,
                version: 1,
                status: "approved",
                reviewedAt: new Date(), // makes it appear in historical list
                forecastStateJson: JSON.stringify(mockForecastJson)
            }
        });

        // Test 1: Dashboard API
        mockState.userId = "user-123";
        mockState.tenantId = tenantId;

        const reqDash = new NextRequest("http://localhost/api/dashboard");
        const resDash = await getDashboard(reqDash);
        const dashData = await resDash.json();

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

        assert(resDash.status === 200, `Dashboard API status is ${resDash.status}`);
        assert(dashData.executionPlan !== undefined, "Dashboard returns executionPlan");
        assert(dashData.executionPlan?.planForecast?.weeks?.length === 2, "Dashboard executionPlan includes parsed forecastStateJson");
        assert(dashData.postApprovalChanges !== undefined, "Dashboard includes postApprovalChanges");
        
        // Test 2: Review API
        const reqReview = new NextRequest("http://localhost/api/review");
        const resReview = await getReview(reqReview);
        const revData = await resReview.json();

        if (resReview.status !== 200) console.error("Review Error:", revData);

        assert(resReview.status === 200, `Review API status is ${resReview.status}`);
        
        // Verify active plan week selection
        assert(revData.active?.originalPlan?.forecastStateJson?.weekStart === currentWeekStart.toISOString(), "Active originalPlan extracted the correct current week object");
        
        // Verify historical plan week selection
        const histPlan = revData.historical.find((h: any) => h.weekStart === priorWeekStart.toISOString());
        assert(histPlan !== undefined, "Historical review found for prior week");
        assert(histPlan?.originalPlan?.forecastStateJson?.weekStart === priorWeekStart.toISOString(), "Historical originalPlan extracted the correct prior week object from the array");
        assert(histPlan?.originalPlan?.forecastStateJson?.endCashExpected === 10000, "Historical originalPlan contains the correct frozen approved value");

        console.log(`\nVerification complete. Passed: ${passed}, Failed: ${failed}`);
        if (failed > 0) process.exit(1);

    } finally {
        console.log("\nCleaning up verification records...");
        await prisma.executionPlan.deleteMany({ where: { companyId: tenantId } });
        await prisma.cashSnapshot.deleteMany({ where: { companyId: tenantId } });
        await prisma.company.deleteMany({ where: { id: tenantId } });
    }
}

runTests().catch(e => {
    console.error("Crash", e);
    process.exit(1);
});
