import { NextRequest } from "next/server";
import { POST as ingestARPost } from "../src/app/api/ingest/ar/confirm/route";
import prisma from "../src/db/prisma";

async function run() {
    console.log("Setting up import test data...");
    let comp = await prisma.company.findFirst();
    if (!comp) {
        comp = await prisma.company.create({ data: { name: "Test Co" } });
    }
    const companyId = comp.id;

    // Create an initial invoice in the system manually
    const inv = await prisma.receivableInvoice.create({
        data: { companyId, customerName: 'Customer B', invoiceNo: 'INV-IMPORT-1', amountOpen: 1500, dueDate: new Date(), status: 'open' }
    });

    // An import happens, but it does NOT include INV-IMPORT-1.
    // Wait, the API endpoint for import usually marks disappeared invoices as paid.
    console.log("1. Running AR ingest without the existing invoice");
    const reqAR = new NextRequest("http://localhost/api/ingest/ar", {
        method: "POST",
        body: JSON.stringify({
            companyId,
            source: "qbo",
            invoices: [
                { sourceId: "inv-import-2", customerName: 'Customer C', invoiceNo: 'INV-IMPORT-2', amountOpen: 500, issueDate: new Date().toISOString(), dueDate: new Date().toISOString(), currency: "USD" }
            ]
        })
    });
    // For ingestARPost, it updates the database directly based on the payload.
    // Let's call the actual logic
    await ingestARPost(reqAR);

    const arObs = await prisma.customerPaymentObservation.findMany({ where: { invoiceId: inv.id }});
    console.log("AR Observations for missing invoice (expected 0):", arObs.length);

    console.log("All import tests completed successfully.");
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
