import "dotenv/config";
import { Module } from "module";
import { NextRequest } from "next/server";
import prisma from "../src/db/prisma";

// 1. Intercept Clerk and resolveTenant
const mockState = {
    userId: null as string | null,
    tenantId: null as string | null
};

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

const { GET: getDashboard } = require("../src/app/api/dashboard/route");

const FRESHNESS_THRESHOLD_DAYS = 7;

function isStaleDate(dateStr: string | null): boolean {
    if (!dateStr) return true;
    const diffTime = Date.now() - new Date(dateStr).getTime();
    return diffTime > FRESHNESS_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
}

async function runTests() {
    console.log("=== Running Slice 6A Verification (Data Freshness Signaling) ===");

    const prefix = "test6a-" + Date.now();
    const tenantIdComplete = `${prefix}-complete`;
    const tenantIdMissing = `${prefix}-missing`;

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
        // --- 1. Unit Tests for Freshness Warning Logic ---
        console.log("\n--- Staleness Helper Logic Tests ---");
        const now = Date.now();
        const realDateNow = Date.now;
        // Mock Date.now to freeze time
        Date.now = () => now;

        try {
            const exactlySevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
            const slightlyMoreThanSevenDaysAgo = new Date(now - (7 * 24 * 60 * 60 * 1000 + 5000)).toISOString();
            const lessThanSevenDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();

            assert(isStaleDate(null) === true, "Missing date is stale");
            assert(isStaleDate(exactlySevenDaysAgo) === false, "Exactly 7 days is not stale");
            assert(isStaleDate(slightlyMoreThanSevenDaysAgo) === true, "Slightly more than 7 days is stale");
            assert(isStaleDate(lessThanSevenDaysAgo) === false, "Less than 7 days is not stale");
        } finally {
            // Restore Date.now
            Date.now = realDateNow;
        }

        // --- 2. Database Integration Tests ---
        console.log("\n--- Database & API Freshness Property Tests ---");

        // Set up Complete Tenant
        await prisma.company.create({ data: { id: tenantIdComplete, name: "Slice 6A Complete Co" } });
        const asOfDate = new Date();
        const bankUploadedAt = new Date(now - 2 * 24 * 60 * 60 * 1000);
        const arUploadedAt = new Date(now - 8 * 24 * 60 * 60 * 1000); // stale (> 7 days)
        const apUploadedAt = new Date(now - 1 * 24 * 60 * 60 * 1000);

        await prisma.cashSnapshot.create({
            data: {
                id: `snap-c-${prefix}`,
                companyId: tenantIdComplete,
                asOfDate,
                bankBalance: 12000
            }
        });

        // Create independent upload batches
        await prisma.importBatch.create({
            data: {
                id: `batch-c-bank-${prefix}`,
                companyId: tenantIdComplete,
                importType: "bank",
                filename: "bank.csv",
                uploadedAt: bankUploadedAt,
                rowCount: 10
            }
        });
        await prisma.importBatch.create({
            data: {
                id: `batch-c-ar-${prefix}`,
                companyId: tenantIdComplete,
                importType: "ar",
                filename: "ar.csv",
                uploadedAt: arUploadedAt,
                rowCount: 10
            }
        });
        await prisma.importBatch.create({
            data: {
                id: `batch-c-ap-${prefix}`,
                companyId: tenantIdComplete,
                importType: "ap",
                filename: "ap.csv",
                uploadedAt: apUploadedAt,
                rowCount: 10
            }
        });

        // Set up Missing Tenant (no upload batches)
        await prisma.company.create({ data: { id: tenantIdMissing, name: "Slice 6A Missing Co" } });
        await prisma.cashSnapshot.create({
            data: {
                id: `snap-m-${prefix}`,
                companyId: tenantIdMissing,
                asOfDate,
                bankBalance: 5000
            }
        });

        // Test GET API for Complete Tenant
        mockState.userId = "user-complete";
        mockState.tenantId = tenantIdComplete;
        const requestComplete = new NextRequest(`http://localhost/api/dashboard?companyId=${tenantIdComplete}`);
        const responseComplete = await getDashboard(requestComplete);
        const dataComplete = await responseComplete.json();

        assert(responseComplete.status === 200, "Dashboard API returned 200 for complete tenant");
        assert(dataComplete.freshness !== undefined, "freshness object returned in dashboard response");
        assert(dataComplete.freshness.bankBalanceAsOf === asOfDate.toISOString(), "bankBalanceAsOf matches CashSnapshot asOfDate");
        assert(dataComplete.freshness.bankLastImportedAt === bankUploadedAt.toISOString(), "bankLastImportedAt matches latest bank ImportBatch");
        assert(dataComplete.freshness.arLastImportedAt === arUploadedAt.toISOString(), "arLastImportedAt matches latest ar ImportBatch");
        assert(dataComplete.freshness.apLastImportedAt === apUploadedAt.toISOString(), "apLastImportedAt matches latest ap ImportBatch");
        assert(typeof dataComplete.freshness.forecastCalculatedAt === "string", "forecastCalculatedAt is returned as string");

        // Test staleness computation on complete data
        const isCompleteBankStale = isStaleDate(dataComplete.freshness.bankLastImportedAt);
        const isCompleteArStale = isStaleDate(dataComplete.freshness.arLastImportedAt);
        const isCompleteApStale = isStaleDate(dataComplete.freshness.apLastImportedAt);
        assert(isCompleteBankStale === false, "Bank upload is not stale (2 days old)");
        assert(isCompleteArStale === true, "AR upload is stale (8 days old)");
        assert(isCompleteApStale === false, "AP upload is not stale (1 day old)");

        // Test GET API for Missing Tenant
        mockState.userId = "user-missing";
        mockState.tenantId = tenantIdMissing;
        const requestMissing = new NextRequest(`http://localhost/api/dashboard?companyId=${tenantIdMissing}`);
        const responseMissing = await getDashboard(requestMissing);
        const dataMissing = await responseMissing.json();

        assert(responseMissing.status === 200, "Dashboard API returned 200 for missing tenant");
        assert(dataMissing.freshness.bankLastImportedAt === null, "bankLastImportedAt is null when missing");
        assert(dataMissing.freshness.arLastImportedAt === null, "arLastImportedAt is null when missing");
        assert(dataMissing.freshness.apLastImportedAt === null, "apLastImportedAt is null when missing");

        // Test staleness computation on missing data
        assert(isStaleDate(dataMissing.freshness.bankLastImportedAt) === true, "Missing bank upload is stale");
        assert(isStaleDate(dataMissing.freshness.arLastImportedAt) === true, "Missing AR upload is stale");
        assert(isStaleDate(dataMissing.freshness.apLastImportedAt) === true, "Missing AP upload is stale");

    } catch (err: any) {
        console.error("Test execution failed:", err);
        failed++;
    } finally {
        // Cleanup database records
        console.log("\n--- Cleaning up test records ---");
        try {
            await prisma.importBatch.deleteMany({ where: { companyId: { in: [tenantIdComplete, tenantIdMissing] } } });
            await prisma.cashSnapshot.deleteMany({ where: { companyId: { in: [tenantIdComplete, tenantIdMissing] } } });
            await prisma.company.deleteMany({ where: { id: { in: [tenantIdComplete, tenantIdMissing] } } });
            console.log("Cleanup finished successfully.");
        } catch (cleanupErr) {
            console.error("Database cleanup failed:", cleanupErr);
        }
    }

    console.log(`\n=== Verification Complete: ${passed} passed, ${failed} failed ===`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
