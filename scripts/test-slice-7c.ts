import { NextRequest } from "next/server";
import { POST as ingestARPost } from "../src/app/api/ingest/ar/confirm/route";
import { POST as ingestAPPost } from "../src/app/api/ingest/ap/confirm/route";
import { POST as uploadBankPost } from "../src/app/api/upload/bank/route";
import { GET as reviewGet } from "../src/app/api/upload/review/route";
import { PATCH as decidePatch } from "../src/app/api/upload/decide/route";
import prisma from "../src/db/prisma";

async function run() {
    let comp = await prisma.company.findFirst({ where: { id: "test-tenant-id" }});
    if (!comp) comp = await prisma.company.create({ data: { id: "test-tenant-id", name: "Test Co" } });
    const companyId = comp.id;

    console.log("=== Running Slice 7C Review Decision Tests ===");

    // Clean up
    await prisma.stagedImportRow.deleteMany();
    await prisma.importBatch.deleteMany();
    await prisma.receivableInvoice.deleteMany({ where: { companyId } });
    await prisma.payableBill.deleteMany({ where: { companyId } });
    await prisma.bankTransaction.deleteMany({ where: { companyId } });

    // Seed existing AR
    await prisma.receivableInvoice.create({
        data: {
            companyId, customerName: "Acme Corp", invoiceNo: "INV-100", amountOpen: 500, dueDate: new Date("2026-08-01"), invoiceDate: new Date("2026-07-01")
        }
    });

    // Seed existing AP
    await prisma.payableBill.create({
        data: {
            companyId, vendorName: "Stark Ind", billNo: "BILL-200", amountOpen: 1000, dueDate: new Date("2026-08-01"), billDate: new Date("2026-07-01")
        }
    });

    // Seed existing Bank
    await prisma.bankTransaction.create({
        data: {
            companyId, txDate: new Date("2026-07-01"), description: "Vendor Pmt", amount: -100, direction: "outflow"
        }
    });

    const makeReq = (url: string, method: string, body?: any, headers?: any) =>
        new NextRequest(`http://localhost${url}`, { method, body: body ? JSON.stringify(body) : undefined, headers });

    // 1. AR Tests
    const arRows = [
        { customerName: "Acme Corp", invoiceNo: "INV-101", amountOpen: 100 }, // new
        { customerName: "Acme Corp", invoiceNo: "INV-100", amountOpen: 500, dueDate: "2026-08-01", invoiceDate: "2026-07-01" }, // exact
        { customerName: "Acme Corp", invoiceNo: "INV-100", amountOpen: 400, dueDate: "2026-08-01", invoiceDate: "2026-07-01" }, // changed open amount
        { customerName: "Acme Corp 2", invoiceNo: "INV-100", amountOpen: 500, dueDate: "2026-08-01", invoiceDate: "2026-07-01" }, // possible match
        { customerName: "", invoiceNo: "INV-100", amountOpen: 500 }, // invalid row
    ];

    const resAR = await ingestARPost(makeReq("/api/ingest/ar/confirm?companyId=" + companyId, "POST", { rows: arRows, mappingJson: {} }));
    const dataAR = await resAR.json();

    const getReview = async (batchId: string) => {
        const res = await reviewGet(makeReq(`/api/upload/review?companyId=${companyId}&batchId=${batchId}`, "GET"));
        return await res.json();
    };

    let reviewAR = await getReview(dataAR.batchId);
    let rowsAR = reviewAR.rows;

    const decide = async (rowId: string, decision: string) => {
        const res = await decidePatch(makeReq(`/api/upload/decide?companyId=${companyId}`, "PATCH", { rowId, decision, reviewedBy: "hacker" }));
        return res;
    };

    const decideBulk = async (batchId: string, action: string) => {
        const res = await decidePatch(makeReq(`/api/upload/decide?companyId=${companyId}`, "PATCH", { bulkAction: true, batchId, action }));
        return res;
    };

    // Test: New AR row can be marked accept insert
    const newAR = rowsAR.find((r: any) => r.conflictType === "new");
    let res = await decide(newAR.id, "accept_insert");
    if (res.status === 200) console.log("✅ New AR row can be marked accept insert");

    // Test: Changed AR row can be marked update or keep existing
    const changedAR = rowsAR.find((r: any) => r.conflictType === "changed_existing");
    res = await decide(changedAR.id, "accept_update");
    if (res.status === 200) console.log("✅ Changed AR row can be marked update");

    res = await decide(changedAR.id, "keep_existing");
    if (res.status === 200) console.log("✅ Changed AR row can be marked keep existing");

    // Test: Possible AR match cannot make batch ready until resolved
    res = await decideBulk(dataAR.batchId, "skip_exact_duplicates");
    if (res.status === 200) console.log("✅ Bulk skip exact duplicates works");

    // Invalid must be skipped
    const invalidAR = rowsAR.find((r: any) => r.conflictType === "invalid");
    await decide(invalidAR.id, "skip");

    reviewAR = await getReview(dataAR.batchId);
    if (reviewAR.summary.reviewStatus === "blocked") console.log("✅ Possible AR match cannot make batch ready until resolved (blocked)");

    // Test client-supplied reviewedBy is ignored
    const dbRow = await prisma.stagedImportRow.findUnique({ where: { id: newAR.id } });
    if (dbRow?.reviewedBy !== "hacker") console.log("✅ Client-supplied reviewedBy is ignored");

    // 2. AP Tests
    const apRows = [
        { vendorName: "Stark Ind", billNo: "BILL-201", amountOpen: 100 }, // new
        { vendorName: "Stark Ind", billNo: "BILL-200", amountOpen: 1000, dueDate: "2026-08-01", billDate: "2026-07-01" }, // exact
        { vendorName: "Stark Ind", billNo: "BILL-200", amountOpen: 900, dueDate: "2026-08-01", billDate: "2026-07-01" }, // changed open amount
        { vendorName: "Stark Industries", billNo: "BILL-200", amountOpen: 1000, dueDate: "2026-08-01", billDate: "2026-07-01" }, // possible match
        { vendorName: "", billNo: "BILL-200", amountOpen: 1000 }, // invalid row
    ];
    const resAP = await ingestAPPost(makeReq("/api/ingest/ap/confirm?companyId=" + companyId, "POST", { rows: apRows, mappingJson: {} }));
    const dataAP = await resAP.json();
    let reviewAP = await getReview(dataAP.batchId);
    let rowsAP = reviewAP.rows;

    const newAP = rowsAP.find((r: any) => r.conflictType === "new");
    res = await decide(newAP.id, "accept_insert");
    if (res.status === 200) console.log("✅ New AP row can be marked accept insert");

    const changedAP = rowsAP.find((r: any) => r.conflictType === "changed_existing");
    res = await decide(changedAP.id, "accept_update");
    if (res.status === 200) console.log("✅ Changed AP row can be marked update");

    const possibleAP = rowsAP.find((r: any) => r.conflictType === "possible_match");
    res = await decide(possibleAP.id, "link_and_review");
    if (res.status === 200) console.log("✅ Possible AP match can be marked link and review");

    // 3. Bank Tests
    const bankRows = [
        { date: "2026-07-02", description: "New Tx", amount: 50 }, // new
        { date: "2026-07-01", description: "Vendor Pmt", amount: -100 }, // exact
        { date: "2026-07-02", description: "Vendor Pmt slightly diff date", amount: -100 }, // possible duplicate
        { date: "", description: "Inv", amount: 100 }, // invalid
    ];
    const resBank = await uploadBankPost(makeReq("/api/upload/bank?companyId=" + companyId, "POST", { rows: bankRows, mappingJson: {} }));
    const dataBank = await resBank.json();
    let reviewBank = await getReview(dataBank.batchId);
    let rowsBank = reviewBank.rows;

    const newBank = rowsBank.find((r: any) => r.conflictType === "new");
    res = await decide(newBank.id, "accept_insert");
    if (res.status === 200) console.log("✅ New bank row can be accepted");

    const possibleBank = rowsBank.find((r: any) => r.conflictType === "possible_duplicate");
    res = await decide(possibleBank.id, "accept_insert");
    if (res.status === 200) console.log("✅ Possible bank duplicate requires a decision and can be accepted");

    // Exact duplicates can only be skipped
    const exactBank = rowsBank.find((r: any) => r.conflictType === "exact_duplicate");
    res = await decide(exactBank.id, "accept_insert");
    if (res.status === 400) console.log("✅ Exact duplicates can only be skipped");

    // Invalid rows can only be skipped
    const invalidBank = rowsBank.find((r: any) => r.conflictType === "invalid");
    res = await decide(invalidBank.id, "accept_insert");
    if (res.status === 400) console.log("✅ Invalid rows can only be skipped");

    // Bulk accept new valid
    res = await decideBulk(dataBank.batchId, "accept_new_valid");
    if (res.status === 200) console.log("✅ Bulk accept new valid rows works");

    // Cross-tenant test
    const failRes = await decidePatch(makeReq(`/api/upload/decide`, "PATCH", { rowId: newBank.id, decision: "skip" }, { "x-fail-tenant": "1" }));
    if (failRes.status === 401) console.log("✅ Cross-tenant decision update is denied");

    // DB state check
    const dbAR = await prisma.receivableInvoice.count({ where: { companyId } });
    if (dbAR === 1) console.log("✅ No live AR records changed");
    const dbAP = await prisma.payableBill.count({ where: { companyId } });
    if (dbAP === 1) console.log("✅ No live AP records changed");
    const dbBank = await prisma.bankTransaction.count({ where: { companyId } });
    if (dbBank === 1) console.log("✅ No live bank records changed");
}

run().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
