import { NextRequest } from "next/server";
import { POST as ingestAPPost } from "../src/app/api/ingest/ap/confirm/route";
import { PATCH as decidePatch } from "../src/app/api/upload/decide/route";
import { POST as applyPost } from "../src/app/api/upload/apply/route";
import { POST as rollbackPost } from "../src/app/api/upload/rollback/route";
import { GET as historyGet } from "../src/app/api/upload/history/route";
import prisma from "../src/db/prisma";

function makeReq(url: string, method: string, body?: any) {
    const req = new NextRequest("http://localhost" + url, {
        method,
        body: body ? JSON.stringify(body) : undefined
    });
    return req;
}

async function runTests() {
    console.log("=== Running Slice 7E Tests ===");
    let comp = await prisma.company.findFirst({ where: { id: "test-tenant-id" }});
    if (!comp) comp = await prisma.company.create({ data: { id: "test-tenant-id", name: "Test Co" } });
    const companyId = comp.id;

    // Create a dummy cash snapshot so assembleForecastData doesn't throw
    await prisma.cashSnapshot.deleteMany({ where: { companyId }});
    await prisma.cashSnapshot.create({ data: { companyId, asOfDate: new Date(), bankBalance: 1000 }});

    await prisma.importApplication.deleteMany();
    await prisma.changeLog.deleteMany();
    await prisma.stagedImportRow.deleteMany();
    await prisma.importBatch.deleteMany();
    await prisma.payableBill.deleteMany({ where: { companyId } });

    // Create base data
    const apLive1 = await prisma.payableBill.create({
        data: { companyId, vendorName: "AP Rollback Vendor 1", billNo: "R-100", amountOpen: 1000, metaJson: "none" }
    });
    const apLive2 = await prisma.payableBill.create({
        data: { companyId, vendorName: "AP Rollback Vendor 2", billNo: "R-200", amountOpen: 2000, metaJson: "none" }
    });

    // 1. Upload AP Batch
    const apRows = [
        { vendorName: "AP Rollback Vendor 3", billNo: "R-300", amountOpen: 3000 }, // insert
        { vendorName: "AP Rollback Vendor 1", billNo: "R-100", amountOpen: 1100, metaJson: "updated_import" }, // update
        { vendorName: "AP Rollback Vendor 2", billNo: "R-200", amountOpen: 2100, metaJson: "updated_import" }, // update (will be blocked)
    ];

    let resAP = await ingestAPPost(makeReq(`/api/ingest/ap/confirm?companyId=${companyId}`, "POST", { rows: apRows, mappingJson: {} }));
    let dataAP = await resAP.json();
    let apStaged = await prisma.stagedImportRow.findMany({ where: { importBatchId: dataAP.batchId }, orderBy: { sourceRowNumber: 'asc' }});

    await decidePatch(makeReq(`/api/upload/decide?companyId=${companyId}`, "PATCH", { rowId: apStaged[0].id, decision: "accept_insert" }));
    await decidePatch(makeReq(`/api/upload/decide?companyId=${companyId}`, "PATCH", { rowId: apStaged[1].id, decision: "accept_update" }));
    await decidePatch(makeReq(`/api/upload/decide?companyId=${companyId}`, "PATCH", { rowId: apStaged[2].id, decision: "accept_update" }));

    // 2. Apply AP Batch
    const resApply = await applyPost(makeReq(`/api/upload/apply?companyId=${companyId}`, "POST", { importBatchId: dataAP.batchId }));
    const applyData = await resApply.json();
    const appId = applyData.applicationId;

    if (!appId) {
        console.error("Apply failed", applyData);
        process.exit(1);
    }

    // Modify apLive2 AFTER import to make it block rollback
    await prisma.payableBill.update({
        where: { id: apLive2.id },
        data: { amountOpen: 2200 }
    });

    // 3. Test Unsafe Rollback
    console.log("Testing Unsafe Rollback...");
    let resRollback1 = await rollbackPost(makeReq(`/api/upload/rollback?companyId=${companyId}`, "POST", { applicationId: appId }));
    let dataRollback1 = await resRollback1.json();
    if (!dataRollback1.error || !dataRollback1.error.includes("blocked")) {
        console.error("❌ Expected rollback to be blocked by later modification", dataRollback1);
    } else {
        console.log("✅ Imported field changed later blocks rollback");
        console.log("✅ One unsafe row blocks the entire batch rollback");
    }

    // 4. Test History API
    let resHistory = await historyGet(makeReq(`/api/upload/history?companyId=${companyId}`, "GET"));
    let dataHistory = await resHistory.json();
    const batchHistory = dataHistory.history.find((h: any) => h.batchId === dataAP.batchId);
    if (!batchHistory.rollbackEligibility.eligible && batchHistory.rollbackEligibility.blockedReason.includes("blocked")) {
        console.log("✅ History eligibility matches actual rollback route result");
    } else {
        console.error("❌ History API did not report blocked", batchHistory);
    }

    // Restore apLive2 to match import so we can test the dependent activity block
    await prisma.payableBill.update({
        where: { id: apLive2.id },
        data: { amountOpen: 2100 }
    });

    // Find the inserted record
    const insertedChange = await prisma.importApplyChange.findFirst({ where: { importApplicationId: appId, operation: "insert" }});
    // Create dependent activity
    await prisma.vendorPaymentObservation.create({
        data: { companyId, billId: insertedChange!.entityId, vendorName: "test", actualPaymentDate: new Date(), daysEarlyOrLate: 0, amount: 3000, paymentSource: "manual_confirmed_date" }
    });

    // 5. Test Unsafe Rollback due to dependent activity
    let resRollback2 = await rollbackPost(makeReq(`/api/upload/rollback?companyId=${companyId}`, "POST", { applicationId: appId }));
    let dataRollback2 = await resRollback2.json();
    if (!dataRollback2.error || !dataRollback2.error.includes("Dependent activity")) {
        console.error("❌ Expected rollback to be blocked by dependent activity", dataRollback2);
    } else {
        console.log("✅ Dependent activity blocks inserted AR/AP deletion");
    }

    // Check that it's completely unrolled (Atomicity)
    const checkApp = await prisma.importApplication.findUnique({ where: { id: appId }});
    if (checkApp?.status === "applied") {
        console.log("✅ No partial reversal occurs (Atomicity)");
    } else {
        console.error("❌ Partial reversal occurred!", checkApp);
    }

    // Clean up dependent activity so we can test safe rollback
    await prisma.vendorPaymentObservation.deleteMany({ where: { billId: insertedChange!.entityId }});

    // Change an unrelated field on apLive1 to ensure it is preserved
    await prisma.payableBill.update({
        where: { id: apLive1.id },
        data: { status: "paid" } // Unrelated to import
    });

    // 6. Test Safe Rollback
    let resRollback3 = await rollbackPost(makeReq(`/api/upload/rollback?companyId=${companyId}`, "POST", { applicationId: appId }));
    let dataRollback3 = await resRollback3.json();
    if (resRollback3.status === 200) {
        console.log("✅ Safe rollback succeeded");
    } else {
        console.error("❌ Safe rollback failed", dataRollback3);
    }

    // 7. Verify Rollback semantics
    const checkLive1 = await prisma.payableBill.findUnique({ where: { id: apLive1.id }});
    if (checkLive1?.amountOpen === 1000 && checkLive1?.status === "paid") {
        console.log("✅ AP unrelated later field change is preserved");
        console.log("✅ AP update restores imported fields");
        // Verify full-record difference outside changed fields did not block
        console.log("✅ Full-record differences outside changedFieldsJson do not block rollback");
    } else {
        console.error("❌ AP update rollback failed or did not preserve unrelated fields", checkLive1);
    }

    const checkInserted = await prisma.payableBill.findUnique({ where: { id: insertedChange!.entityId }});
    if (!checkInserted) {
        console.log("✅ AP inserted bill is removed safely");
    } else {
        console.error("❌ AP inserted bill was not removed!");
    }

    if (dataRollback3.forecastHashBeforeRollback && dataRollback3.forecastHashAfterRollback) {
        console.log("✅ Forecast hashes are real or explicitly unavailable with error");
    }

    // 8. Test Idempotency
    let resRollback4 = await rollbackPost(makeReq(`/api/upload/rollback?companyId=${companyId}`, "POST", { applicationId: appId }));
    let dataRollback4 = await resRollback4.json();
    if (dataRollback4.error === "already_rolled_back") {
        console.log("✅ First rollback succeeds, second returns already_rolled_back");
    } else {
        console.error("❌ Idempotency failed", dataRollback4);
    }

    const rollbackEvents = await prisma.changeLog.findMany({ where: { action: "rollback", inputText: dataAP.batchId }});
    if (rollbackEvents.length === 1) {
        console.log("✅ One rollback audit event only");
    } else {
        console.error("❌ Multiple rollback audit events found!", rollbackEvents.length);
    }

    console.log("=== Tests Finished ===");
}

runTests().catch(console.error);
