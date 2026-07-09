import { NextRequest } from "next/server";
import { POST as overridesPost, DELETE as overridesDelete } from "../src/app/api/overrides/route";
import prisma from "../src/db/prisma";

async function run() {
    console.log("Setting up test data...");
    let comp = await prisma.company.findFirst();
    if (!comp) {
        comp = await prisma.company.create({ data: { name: "Test Co" } });
    }
    const companyId = comp.id;

    // Create AR
    const inv = await prisma.receivableInvoice.create({
        data: { companyId, customerName: 'Customer A', invoiceNo: 'INV-001', amountOpen: 1000, dueDate: new Date() }
    });

    // Create AP
    const bill = await prisma.payableBill.create({
        data: { companyId, vendorName: 'Vendor A', billNo: 'BILL-001', amountOpen: 500, dueDate: new Date() }
    });

    console.log("1. Executing real AR mark-paid action");
    const reqAR = new NextRequest("http://localhost/api/overrides", {
        method: "POST",
        body: JSON.stringify({
            companyId, type: "mark_paid", targetType: "receivable_invoice", targetId: inv.id, actualPaymentDate: "2026-07-09", paymentSource: "manual_confirmed_date"
        })
    });
    await overridesPost(reqAR);

    let arObs = await prisma.customerPaymentObservation.findMany({ where: { invoiceId: inv.id }});
    console.log("AR Observations (expected 1):", arObs.length);

    console.log("2. Repeating same AR action");
    const reqAR2 = new NextRequest("http://localhost/api/overrides", {
        method: "POST",
        body: JSON.stringify({
            companyId, type: "mark_paid", targetType: "receivable_invoice", targetId: inv.id, actualPaymentDate: "2026-07-09", paymentSource: "manual_confirmed_date"
        })
    });
    await overridesPost(reqAR2);

    arObs = await prisma.customerPaymentObservation.findMany({ where: { invoiceId: inv.id }});
    console.log("AR Observations after repeat (expected 1):", arObs.length);

    console.log("3. Executing real AP mark-paid action");
    const reqAP = new NextRequest("http://localhost/api/overrides", {
        method: "POST",
        body: JSON.stringify({
            companyId, type: "mark_paid", targetType: "payable_bill", targetId: bill.id, actualPaymentDate: "2026-07-09", paymentSource: "manual_confirmed_date"
        })
    });
    await overridesPost(reqAP);

    let apObs = await prisma.vendorPaymentObservation.findMany({ where: { billId: bill.id }});
    console.log("AP Observations (expected 1):", apObs.length);

    console.log("4. Rescheduling AP (delay_due_date)");
    const reqAPDelay = new NextRequest("http://localhost/api/overrides", {
        method: "POST",
        body: JSON.stringify({
            companyId, type: "delay_due_date", targetType: "payable_bill", targetId: bill.id, effectiveDate: "2026-08-01"
        })
    });
    await overridesPost(reqAPDelay);

    apObs = await prisma.vendorPaymentObservation.findMany({ where: { billId: bill.id }});
    console.log("AP Observations after reschedule (expected 1):", apObs.length);

    console.log("All tests completed successfully.");
    process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
