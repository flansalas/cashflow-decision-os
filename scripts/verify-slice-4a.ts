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
const { DELETE: deleteCategory } = require("../src/app/api/cash-categories/[id]/route");
const { PATCH: patchOverrideReason } = require("../src/app/api/overrides/reason/route");

async function runTests() {
    console.log("=== Running Slice 4A Tenant Isolation Verification ===");

    const tenantA = "tenant-a-" + Date.now();
    const tenantB = "tenant-b-" + Date.now();

    // Create companies
    await prisma.company.create({ data: { id: tenantA, name: "Company A" } });
    await prisma.company.create({ data: { id: tenantB, name: "Company B" } });

    // Create a category belonging to Tenant B
    const categoryB = await prisma.cashFlowCategory.create({
        data: {
            id: "cat-b-" + Date.now(),
            companyId: tenantB,
            name: "Category Tenant B",
            direction: "outflow",
            sortOrder: 1
        }
    });

    // Create a category belonging to Tenant A
    const categoryA = await prisma.cashFlowCategory.create({
        data: {
            id: "cat-a-" + Date.now(),
            companyId: tenantA,
            name: "Category Tenant A",
            direction: "outflow",
            sortOrder: 1
        }
    });

    let passedTests = 0;
    let failedTests = 0;

    const assertStatus = (testName: string, response: any, expectedStatus: number) => {
        if (response.status === expectedStatus) {
            console.log(`✅ PASS: ${testName} (Status: ${response.status})`);
            passedTests++;
        } else {
            console.error(`❌ FAIL: ${testName} (Expected: ${expectedStatus}, Got: ${response.status})`);
            failedTests++;
        }
    };

    try {
        // --- Test 1: Unauthenticated request returns 401 ---
        mockState.userId = null;
        mockState.tenantId = null;

        const req1 = new NextRequest("http://localhost/api/cash-categories/" + categoryA.id, { method: "DELETE" });
        const res1 = await deleteCategory(req1, { params: Promise.resolve({ id: categoryA.id }) });
        assertStatus("Unauthenticated request returns 401", res1, 401);

        // --- Test 2: Mismatched companyId in body returns 403 ---
        mockState.userId = "user-123";
        mockState.tenantId = tenantA;

        const req2 = new NextRequest("http://localhost/api/overrides/reason", {
            method: "PATCH",
            body: JSON.stringify({
                companyId: tenantB, // mismatched
                overrideId: "some-id",
                changeLogId: "some-id",
                reason: "testing mismatch"
            })
        });
        const res2 = await patchOverrideReason(req2);
        assertStatus("Mismatched companyId in body returns 403", res2, 403);

        // --- Test 3: Cross-tenant record ID lookup returns 404 ---
        mockState.userId = "user-123";
        mockState.tenantId = tenantA; // Authenticated as Tenant A

        // Try to delete category belonging to Tenant B
        const req3 = new NextRequest("http://localhost/api/cash-categories/" + categoryB.id, { method: "DELETE" });
        const res3 = await deleteCategory(req3, { params: Promise.resolve({ id: categoryB.id }) });
        assertStatus("Cross-tenant record ID lookup returns 404", res3, 404);

        // Verify Category B is NOT deleted from DB
        const catBCheck = await prisma.cashFlowCategory.findUnique({ where: { id: categoryB.id } });
        if (catBCheck) {
            console.log("✅ PASS: Category B was not deleted during cross-tenant deletion attempt");
            passedTests++;
        } else {
            console.error("❌ FAIL: Category B was deleted by cross-tenant deletion!");
            failedTests++;
        }

        // --- Test 4: Valid same-tenant request succeeds (returns 200) ---
        mockState.userId = "user-123";
        mockState.tenantId = tenantA; // Authenticated as Tenant A

        // Delete Category A (belongs to Tenant A)
        const req4 = new NextRequest("http://localhost/api/cash-categories/" + categoryA.id, { method: "DELETE" });
        const res4 = await deleteCategory(req4, { params: Promise.resolve({ id: categoryA.id }) });
        assertStatus("Valid same-tenant request succeeds (returns 200)", res4, 200);

        // Verify Category A IS deleted from DB
        const catACheck = await prisma.cashFlowCategory.findUnique({ where: { id: categoryA.id } });
        if (!catACheck) {
            console.log("✅ PASS: Category A was successfully deleted from database");
            passedTests++;
        } else {
            console.error("❌ FAIL: Category A was not deleted from database");
            failedTests++;
        }

    } finally {
        console.log("\nCleaning up verification records...");
        // Clean up categories
        await prisma.cashFlowCategory.deleteMany({
            where: { id: { in: [categoryA.id, categoryB.id] } }
        });
        // Clean up companies
        await prisma.company.deleteMany({
            where: { id: { in: [tenantA, tenantB] } }
        });
        console.log("Cleanup complete.");
    }

    console.log(`\nVerification complete. Passed: ${passedTests}, Failed: ${failedTests}`);
    if (failedTests > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests().catch((err) => {
    console.error("Verification test run crashed:", err);
    process.exit(1);
});
