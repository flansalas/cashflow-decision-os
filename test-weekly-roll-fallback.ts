import "dotenv/config";
import { NextRequest } from "next/server";
import { POST } from "./src/app/api/cash-checkin/route";
import prisma from "./src/db/prisma";

async function runTest() {
    console.log("=== Testing Weekly Roll Fallback Logic ===\n");

    // We will use an existing company or create a temporary one for this test
    let company = await prisma.company.findFirst({ where: { name: "Test Company (Roll Fallback)" } });
    if (!company) {
        company = await prisma.company.create({
            data: {
                name: "Test Company (Roll Fallback)",
                onboardingCompleted: true,
                onboardingStep: 3,
            }
        });
    }

    const companyId = company.id;

    // Clean up previous runs
    await prisma.cashSnapshot.deleteMany({ where: { companyId } });
    await prisma.baselineVarianceLedger.deleteMany({ where: { companyId } });
    await prisma.bankTransaction.deleteMany({ where: { companyId } });

    // Mock NextRequest helper
    const createReq = (body: any) => {
        return new NextRequest("http://localhost/api/cash-checkin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
    };

    const priorWeekForecast = {
        forecastVersionHash: "test-hash",
        generatedAt: new Date().toISOString(),
        weekStart: new Date(Date.now() - 7 * 86400000).toISOString(),
        weekEnd: new Date().toISOString(),
        endCashExpected: 5000,
        inflowsExpected: 2000,
        outflowsExpected: 1000,
        breakdownJson: JSON.stringify({
            inflows: [
                { label: "Invoice 1", amountExpected: 1000, type: "committed", sourceType: "invoice", sourceId: "inv-1" },
                { label: "Baseline Inflow", amountExpected: 1000, type: "baseline", sourceType: "baseline" }
            ],
            outflows: [
                { label: "Baseline Outflow", amountExpected: 1000, type: "baseline", sourceType: "baseline" }
            ]
        })
    };

    console.log("--- 1. Bank Data Missing (No Ledger, Unverified injection) ---");
    // Wednesday (not Saturday) -> getUTCDay() will depend on date. We will explicitly use a Wednesday date for asOfDate
    const wednesday = new Date("2026-06-10T12:00:00Z"); // Jun 10, 2026 is Wednesday
    let req = createReq({
        companyId,
        bankBalance: 7000, // 2000 unexplained gap
        asOfDate: wednesday.toISOString(),
        priorWeekForecast
    });

    let res = await POST(req);
    let json = await res.json();
    console.log("Response:", json);

    // Check ledger
    let ledgers = await prisma.baselineVarianceLedger.findMany({ where: { companyId } });
    console.log("Ledger Count (should be 0):", ledgers.length);

    let checkpoint = await prisma.forecastCheckpoint.findFirst({ where: { companyId } });
    console.log("Checkpoint Snapshot Source (should be client_observed_unverified):", checkpoint?.snapshotSource);
    if (checkpoint?.breakdownJson) {
        const bd = JSON.parse(checkpoint.breakdownJson);
        const uncat = bd.inflows.find((i: any) => i.label === "Uncategorized Activity (Unverified)");
        console.log("Uncategorized Activity Injected:", !!uncat, uncat ? `amount: ${uncat.amount}` : "");
        console.log("Inflow 1 status:", bd.inflows[0].evidenceStatus, "confidence:", bd.inflows[0].confidence);
    }
    console.log("\n");

    // Clean up
    await prisma.cashSnapshot.deleteMany({ where: { companyId } });
    await prisma.forecastCheckpoint.deleteMany({ where: { companyId } });

    console.log("--- 2. Bank Data Present (Ledger Created, Saturday Roll) ---");
    // Add dummy bank tx
    await prisma.bankTransaction.create({
        data: {
            companyId,
            txDate: new Date(priorWeekForecast.weekStart),
            amount: 1000,
            description: "Test tx",
            direction: "outflow",
        }
    });

    const saturday = new Date("2026-06-13T12:00:00Z"); // Jun 13, 2026 is Saturday
    req = createReq({
        companyId,
        bankBalance: 5000, // matches exactly
        asOfDate: saturday.toISOString(),
        priorWeekForecast
    });

    res = await POST(req);
    json = await res.json();
    console.log("Response:", json); // Should NOT have a warning about Saturday or missing bank data

    ledgers = await prisma.baselineVarianceLedger.findMany({ where: { companyId } });
    console.log("Ledger Count (should be 1):", ledgers.length);
    
    checkpoint = await prisma.forecastCheckpoint.findFirst({ where: { companyId } });
    console.log("Checkpoint Snapshot Source (should be client_observed_v1):", checkpoint?.snapshotSource);
    
    console.log("\nDone testing fallback.");
}

runTest().catch(console.error).finally(() => prisma.$disconnect());
