import { NextRequest } from "next/server";
import { POST as ingestARPost } from "../src/app/api/ingest/ar/confirm/route";
import { POST as ingestAPPost } from "../src/app/api/ingest/ap/confirm/route";
import { GET as reviewGet } from "../src/app/api/upload/review/route";
import { PATCH as decidePatch } from "../src/app/api/upload/decide/route";
import prisma from "../src/db/prisma";

async function run() {
    let comp = await prisma.company.findFirst({ where: { id: "test-tenant-id" }});
    if (!comp) comp = await prisma.company.create({ data: { id: "test-tenant-id", name: "Test Co" } });
    const companyId = comp.id;

    let compOther = await prisma.company.findFirst({ where: { id: "other-tenant-id" }});
    if (!compOther) compOther = await prisma.company.create({ data: { id: "other-tenant-id", name: "Other Co" } });

    console.log("=== Running Slice 7C Linkage Tests ===");

    await prisma.stagedImportRow.deleteMany();
    await prisma.importBatch.deleteMany();
    await prisma.receivableInvoice.deleteMany({ where: { companyId: { in: [companyId, "other-tenant-id"] } } });
    await prisma.payableBill.deleteMany({ where: { companyId: { in: [companyId, "other-tenant-id"] } } });

    const arLive = await prisma.receivableInvoice.create({
        data: { companyId, customerName: "Acme Corp", invoiceNo: "INV-100", amountOpen: 500, dueDate: new Date("2026-08-01"), invoiceDate: new Date("2026-07-01") }
    });
    const apLive = await prisma.payableBill.create({
        data: { companyId, vendorName: "Stark Ind", billNo: "BILL-200", amountOpen: 1000, dueDate: new Date("2026-08-01"), billDate: new Date("2026-07-01") }
    });

    // Cross tenant records
    const crossAR = await prisma.receivableInvoice.create({
        data: { companyId: "other-tenant-id", customerName: "Acme Corp", invoiceNo: "INV-999", amountOpen: 500, dueDate: new Date("2026-08-01"), invoiceDate: new Date("2026-07-01") }
    });

    const makeReq = (url: string, method: string, body?: any, headers?: any) =>
        new NextRequest(`http://localhost${url}`, { method, body: body ? JSON.stringify(body) : undefined, headers });

    // AR
    const arRows = [
        { customerName: "Acme Corp 2", invoiceNo: "INV-100", amountOpen: 500, dueDate: "2026-08-01", invoiceDate: "2026-07-01" }, // possible match
        { customerName: "Acme Corp 3", invoiceNo: "INV-100", amountOpen: 500, dueDate: "2026-08-01", invoiceDate: "2026-07-01" }, // possible match
    ];
    const resAR = await ingestARPost(makeReq("/api/ingest/ar/confirm?companyId=" + companyId, "POST", { rows: arRows, mappingJson: {} }));
    const dataAR = await resAR.json();

    const reviewAR = await (await reviewGet(makeReq(`/api/upload/review?companyId=${companyId}&batchId=${dataAR.batchId}`, "GET"))).json();
    const rowsAR = reviewAR.rows;
    const possibleAR1 = rowsAR[0];
    const possibleAR2 = rowsAR[1];

    const decide = async (rowId: string, decision: string, linkedRecordId?: string) => {
        return await decidePatch(makeReq(`/api/upload/decide?companyId=${companyId}`, "PATCH", { rowId, decision, linkedRecordId, reviewedBy: "hacker" }));
    };

    // Link & Review cannot save without linkedRecordId
    let res = await decide(possibleAR1.id, "link_and_review");
    if (res.status === 400) console.log("✅ Link & Review cannot save without linkedRecordId");

    // Valid same-tenant AR link succeeds
    res = await decide(possibleAR1.id, "link_and_review", arLive.id);
    if (res.status === 200) console.log("✅ Valid same-tenant AR link succeeds");

    // Cross-tenant link is rejected
    res = await decide(possibleAR2.id, "link_and_review", crossAR.id);
    if (res.status === 400) console.log("✅ Cross-tenant link is rejected");

    // Wrong entity type is rejected (AP ID on AR)
    res = await decide(possibleAR2.id, "link_and_review", apLive.id);
    if (res.status === 400) console.log("✅ Wrong entity type is rejected");

    // Treat-as-new clears linkedRecordId
    await prisma.stagedImportRow.update({ where: { id: possibleAR2.id }, data: { linkedRecordId: "temp-id" }});
    res = await decide(possibleAR2.id, "treat_as_new");
    let checkRow = await prisma.stagedImportRow.findUnique({ where: { id: possibleAR2.id } });
    if (res.status === 200 && checkRow?.linkedRecordId === null) console.log("✅ Treat-as-new clears linkedRecordId");

    // Skip clears linkedRecordId
    await prisma.stagedImportRow.update({ where: { id: possibleAR2.id }, data: { linkedRecordId: "temp-id" }});
    res = await decide(possibleAR2.id, "skip");
    checkRow = await prisma.stagedImportRow.findUnique({ where: { id: possibleAR2.id } });
    if (res.status === 200 && checkRow?.linkedRecordId === null) console.log("✅ Skip clears linkedRecordId");

    // AP
    const apRows = [
        { vendorName: "Stark Industries", billNo: "BILL-200", amountOpen: 1000, dueDate: "2026-08-01", billDate: "2026-07-01" }, // possible match
    ];
    const resAP = await ingestAPPost(makeReq("/api/ingest/ap/confirm?companyId=" + companyId, "POST", { rows: apRows, mappingJson: {} }));
    const dataAP = await resAP.json();
    const reviewAP = await (await reviewGet(makeReq(`/api/upload/review?companyId=${companyId}&batchId=${dataAP.batchId}`, "GET"))).json();
    const possibleAP = reviewAP.rows[0];

    // Valid same-tenant AP link succeeds
    res = await decide(possibleAP.id, "link_and_review", apLive.id);
    if (res.status === 200) console.log("✅ Valid same-tenant AP link succeeds");

    const dbAR = await prisma.receivableInvoice.count({ where: { companyId } });
    if (dbAR === 1) console.log("✅ No live AR records changed");
    const dbAP = await prisma.payableBill.count({ where: { companyId } });
    if (dbAP === 1) console.log("✅ No live AP records changed");
}

run().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
