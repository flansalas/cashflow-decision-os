import { NextRequest } from "next/server";
import { POST as ingestARPost } from "../src/app/api/ingest/ar/confirm/route";
import { POST as ingestAPPost } from "../src/app/api/ingest/ap/confirm/route";
import { POST as uploadBankPost } from "../src/app/api/upload/bank/route";
import { GET as previewGet } from "../src/app/api/upload/preview/route";
import prisma from "../src/db/prisma";

async function run() {
    let comp = await prisma.company.findFirst({ where: { id: "test-tenant-id" }});
    if (!comp) comp = await prisma.company.create({ data: { id: "test-tenant-id", name: "Test Co" } });
    const companyId = comp.id;

    console.log("=== Running Slice 7B Classification Tests ===");

    // Clean up
    await prisma.stagedImportRow.deleteMany();
    await prisma.importBatch.deleteMany();
    await prisma.receivableInvoice.deleteMany({ where: { companyId } });
    await prisma.payableBill.deleteMany({ where: { companyId } });
    await prisma.bankTransaction.deleteMany({ where: { companyId } });

    // Seed existing AR
    const existingAR = await prisma.receivableInvoice.create({
        data: {
            companyId,
            customerName: "Acme Corp",
            invoiceNo: "INV-100",
            amountOpen: 500,
            dueDate: new Date("2026-08-01"),
            invoiceDate: new Date("2026-07-01")
        }
    });

    // Seed existing AP
    const existingAP = await prisma.payableBill.create({
        data: {
            companyId,
            vendorName: "Stark Ind",
            billNo: "BILL-200",
            amountOpen: 1000,
            dueDate: new Date("2026-08-01"),
            billDate: new Date("2026-07-01")
        }
    });

    // Seed existing Bank
    const existingBank = await prisma.bankTransaction.create({
        data: {
            companyId,
            txDate: new Date("2026-07-01"),
            description: "Vendor Pmt",
            amount: -100,
            direction: "outflow"
        }
    });

    console.log("\\nTesting AR Classification...");
    const arRows = [
        { customerName: "Acme Corp", invoiceNo: "INV-101", amountOpen: 100 }, // new
        { customerName: "Acme Corp", invoiceNo: "INV-100", amountOpen: 500, dueDate: "2026-08-01", invoiceDate: "2026-07-01" }, // exact
        { customerName: "Acme Corp", invoiceNo: "INV-100", amountOpen: 400, dueDate: "2026-08-01", invoiceDate: "2026-07-01" }, // changed open amount
        { customerName: "Acme Corp", invoiceNo: "INV-100", amountOpen: 500, dueDate: "2026-08-15", invoiceDate: "2026-07-01" }, // changed due date
        { customerName: "Acme Corp 2", invoiceNo: "INV-100", amountOpen: 500, dueDate: "2026-08-01", invoiceDate: "2026-07-01" }, // possible match
        { customerName: "", invoiceNo: "INV-100", amountOpen: 500 }, // invalid row
    ];

    const reqAR = new NextRequest("http://localhost/api/ingest/ar/confirm?companyId=" + companyId, {
        method: "POST", body: JSON.stringify({ rows: arRows, mappingJson: {} })
    });
    const resAR = await ingestARPost(reqAR);
    const dataAR = await resAR.json();

    const previewARReq = new NextRequest(`http://localhost/api/upload/preview?companyId=${companyId}&batchId=${dataAR.batchId}`);
    const previewARRes = await previewGet(previewARReq);
    const previewAR = await previewARRes.json();

    // Verify AR
    let arPass = true;
    const pRowsAR = previewAR.rows;
    if (pRowsAR[0].conflictType !== "new") arPass = false;
    if (pRowsAR[1].conflictType !== "exact_duplicate") arPass = false;
    if (pRowsAR[2].conflictType !== "changed_existing") arPass = false;
    if (pRowsAR[3].conflictType !== "changed_existing") arPass = false;
    if (pRowsAR[4].conflictType !== "possible_match") arPass = false;
    if (pRowsAR[5].conflictType !== "invalid") arPass = false;

    if (arPass) console.log("✅ AR tests passed");
    else console.log("❌ AR tests failed", pRowsAR);

    console.log("\\nTesting AP Classification...");
    const apRows = [
        { vendorName: "Stark Ind", billNo: "BILL-201", amountOpen: 100 }, // new
        { vendorName: "Stark Ind", billNo: "BILL-200", amountOpen: 1000, dueDate: "2026-08-01", billDate: "2026-07-01" }, // exact
        { vendorName: "Stark Ind", billNo: "BILL-200", amountOpen: 900, dueDate: "2026-08-01", billDate: "2026-07-01" }, // changed open amount
        { vendorName: "Stark Ind", billNo: "BILL-200", amountOpen: 1000, dueDate: "2026-08-15", billDate: "2026-07-01" }, // changed due date
        { vendorName: "Stark Industries", billNo: "BILL-200", amountOpen: 1000, dueDate: "2026-08-01", billDate: "2026-07-01" }, // possible match
        { vendorName: "", billNo: "BILL-200", amountOpen: 1000 }, // invalid row
    ];
    const reqAP = new NextRequest("http://localhost/api/ingest/ap/confirm?companyId=" + companyId, {
        method: "POST", body: JSON.stringify({ rows: apRows, mappingJson: {} })
    });
    const resAP = await ingestAPPost(reqAP);
    const dataAP = await resAP.json();

    const previewAPReq = new NextRequest(`http://localhost/api/upload/preview?companyId=${companyId}&batchId=${dataAP.batchId}`);
    const previewAPRes = await previewGet(previewAPReq);
    const previewAP = await previewAPRes.json();

    let apPass = true;
    const pRowsAP = previewAP.rows;
    if (pRowsAP[0].conflictType !== "new") apPass = false;
    if (pRowsAP[1].conflictType !== "exact_duplicate") apPass = false;
    if (pRowsAP[2].conflictType !== "changed_existing") apPass = false;
    if (pRowsAP[3].conflictType !== "changed_existing") apPass = false;
    if (pRowsAP[4].conflictType !== "possible_match") apPass = false;
    if (pRowsAP[5].conflictType !== "invalid") apPass = false;

    if (apPass) console.log("✅ AP tests passed");
    else console.log("❌ AP tests failed", pRowsAP);


    console.log("\\nTesting Bank Classification...");
    const bankRows = [
        { date: "2026-07-02", description: "New Tx", amount: 50 }, // new
        { date: "2026-07-01", description: "Vendor Pmt", amount: -100 }, // exact
        { date: "2026-07-02", description: "Vendor Pmt slightly diff date", amount: -100 }, // possible duplicate
        { date: "", description: "Inv", amount: 100 }, // invalid
    ];
    const reqBank = new NextRequest("http://localhost/api/upload/bank?companyId=" + companyId, {
        method: "POST", body: JSON.stringify({ rows: bankRows, mappingJson: {} })
    });
    const resBank = await uploadBankPost(reqBank);
    const dataBank = await resBank.json();

    const previewBankReq = new NextRequest(`http://localhost/api/upload/preview?companyId=${companyId}&batchId=${dataBank.batchId}`);
    const previewBankRes = await previewGet(previewBankReq);
    const previewBank = await previewBankRes.json();

    let bankPass = true;
    const pRowsBank = previewBank.rows;
    if (pRowsBank[0].conflictType !== "new") bankPass = false;
    if (pRowsBank[1].conflictType !== "exact_duplicate") bankPass = false;
    if (pRowsBank[2].conflictType !== "possible_duplicate") bankPass = false;
    if (pRowsBank[3].conflictType !== "invalid") bankPass = false;

    if (bankPass) console.log("✅ Bank tests passed");
    else console.log("❌ Bank tests failed", pRowsBank);

    // Cross-tenant failure
    const reqFail = new NextRequest("http://localhost/api/upload/bank", {
        method: "POST",
        headers: { "x-fail-tenant": "1" },
        body: JSON.stringify({ rows: [], mappingJson: {} })
    });
    const resFail = await uploadBankPost(reqFail);
    if (resFail.status === 401) {
        console.log("✅ Cross-tenant staging attempt is rejected");
    } else {
        console.log("❌ Cross-tenant staging attempt failed to reject", resFail.status);
    }
}

run().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
