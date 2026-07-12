import "dotenv/config";
import prisma from "../src/db/prisma";
import { assembleForecastData } from "../src/services/forecast-assembly";
import { v4 as uuidv4 } from "uuid";

async function runVerification() {
    console.log("Starting forecast separation automated verification...");

    // Find a company with bills and invoices (like the demo company)
    const company = await prisma.company.findFirst({
        where: {
            payableBills: { some: {} },
            receivableInvoices: { some: {} }
        }
    });
    if (!company) {
        console.error("FAIL: No company with bills/invoices found in DB.");
        process.exit(1);
    }
    const companyId = company.id;
    console.log(`Using company: ${company.name} (${companyId})`);

    // Ensure we have at least one bill and invoice in the forecast window to test overrides against
    const baseMonday = new Date("2026-07-06T00:00:00Z");
    const bill = await prisma.payableBill.findFirst({
        where: {
            companyId,
            status: "open",
            amountOpen: { gt: 0 },
            dueDate: { gte: baseMonday }
        }
    });
    const invoice = await prisma.receivableInvoice.findFirst({
        where: {
            companyId,
            status: "open",
            amountOpen: { gt: 0 },
            dueDate: { gte: baseMonday }
        }
    });

    if (!bill || !invoice) {
        console.error("FAIL: Make sure company has at least 1 PayableBill and 1 ReceivableInvoice.");
        process.exit(1);
    }

    let testSuccess = true;

    // Helper to run cleanups
    const cleanup = async () => {
        await prisma.override.deleteMany({
            where: {
                companyId,
                targetId: { in: [bill.id, invoice.id] },
                metaJson: "TEST_OVERRIDE"
            }
        });
    };

    try {
        await cleanup();

        // ────────────────────────────────────────────────────────────────
        // TEST 1: Confirm no overrides produce identical Organic and Managed results
        // ────────────────────────────────────────────────────────────────
        console.log("\n--- TEST 1: Identical forecasts without overrides ---");
        const resBaseline = await assembleForecastData(companyId);
        const managedBaselineWeeks = resBaseline.forecastResult.weeks;
        const organicBaselineWeeks = resBaseline.organicForecast.weeks;

        for (let i = 0; i < managedBaselineWeeks.length; i++) {
            if (managedBaselineWeeks[i].endCashExpected !== organicBaselineWeeks[i].endCashExpected) {
                console.error(`FAIL: Week ${i} expected cash differs. Managed: ${managedBaselineWeeks[i].endCashExpected}, Organic: ${organicBaselineWeeks[i].endCashExpected}`);
                testSuccess = false;
            }
        }
        if (testSuccess) console.log("PASS: Forecasts are identical when no overrides exist.");

        // ────────────────────────────────────────────────────────────────
        // TEST 2: Confirm a delay_due_date override changes Managed but not Organic
        // ────────────────────────────────────────────────────────────────
        console.log("\n--- TEST 2: delay_due_date affects Managed only ---");
        // Create delay_due_date override on the bill
        // Add 10 weeks delay to push it into a later week
        const futureDate = new Date(bill.dueDate!);
        futureDate.setDate(futureDate.getDate() + 70);

        await prisma.override.create({
            data: {
                id: uuidv4(),
                companyId,
                type: "delay_due_date",
                targetType: "payable_bill",
                targetId: bill.id,
                effectiveDate: futureDate,
                metaJson: "TEST_OVERRIDE"
            }
        });

        const resDelay = await assembleForecastData(companyId);
        const managedDelayWeeks = resDelay.forecastResult.weeks;
        const organicDelayWeeks = resDelay.organicForecast.weeks;

        let hasManagedDifference = false;
        let hasOrganicDifference = false;

        for (let i = 0; i < managedDelayWeeks.length; i++) {
            if (managedDelayWeeks[i].endCashExpected !== managedBaselineWeeks[i].endCashExpected) {
                hasManagedDifference = true;
            }
            if (organicDelayWeeks[i].endCashExpected !== organicBaselineWeeks[i].endCashExpected) {
                hasOrganicDifference = true;
            }
        }

        if (!hasManagedDifference) {
            console.error("FAIL: Managed forecast was not affected by delay_due_date.");
            testSuccess = false;
        } else {
            console.log("PASS: Managed forecast changed after delay_due_date override.");
        }

        if (hasOrganicDifference) {
            console.error("FAIL: Organic forecast was affected by delay_due_date.");
            testSuccess = false;
        } else {
            console.log("PASS: Organic forecast remained unchanged after delay_due_date override.");
        }

        await cleanup();

        // ────────────────────────────────────────────────────────────────
        // TEST 3: Confirm adjust_amount affects both forecasts identically
        // ────────────────────────────────────────────────────────────────
        console.log("\n--- TEST 3: adjust_amount affects both forecasts identically ---");
        // Set the bill's amount to 0 (effectively excluding its cash impact, or reducing it)
        await prisma.override.create({
            data: {
                id: uuidv4(),
                companyId,
                type: "adjust_amount",
                targetType: "payable_bill",
                targetId: bill.id,
                amount: bill.amountOpen + 1000000.0, // Huge adjustment to guarantee cash difference
                metaJson: "TEST_OVERRIDE"
            }
        });

        const resAdjust = await assembleForecastData(companyId);
        const managedAdjustWeeks = resAdjust.forecastResult.weeks;
        const organicAdjustWeeks = resAdjust.organicForecast.weeks;

        let hasAdjustManagedDiff = false;
        let organicEqualsManaged = true;

        for (let i = 0; i < managedAdjustWeeks.length; i++) {
            if (managedAdjustWeeks[i].endCashExpected !== managedBaselineWeeks[i].endCashExpected) {
                hasAdjustManagedDiff = true;
            }
            if (managedAdjustWeeks[i].endCashExpected !== organicAdjustWeeks[i].endCashExpected) {
                organicEqualsManaged = false;
            }
        }

        if (!hasAdjustManagedDiff) {
            console.error("FAIL: adjust_amount did not affect Managed forecast.");
            testSuccess = false;
        } else {
            console.log("PASS: adjust_amount affected the Managed forecast.");
        }

        if (!organicEqualsManaged) {
            console.error("FAIL: Organic and Managed forecasts differed after adjust_amount.");
            testSuccess = false;
        } else {
            console.log("PASS: Organic and Managed forecasts are identical under adjust_amount override.");
        }

    } catch (err) {
        console.error("An error occurred during verification", err);
        testSuccess = false;
    } finally {
        await cleanup();
    }

    if (testSuccess) {
        console.log("\n✅ ALL VERIFICATION TESTS PASSED!");
        process.exit(0);
    } else {
        console.error("\n❌ SOME VERIFICATION TESTS FAILED!");
        process.exit(1);
    }
}

runVerification();
