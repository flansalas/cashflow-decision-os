import prisma from "../src/db/prisma";

async function verify() {
    const comp = await prisma.company.findFirst();
    if (!comp) {
        console.log("No company");
        return;
    }
    const inv = await prisma.receivableInvoice.findFirst();
    const bill = await prisma.payableBill.findFirst();

    console.log("Company:", comp.id);
    if (inv) {
        const obs = await prisma.customerPaymentObservation.findMany({ where: { invoiceId: inv.id }});
        console.log("AR Obs:", obs.length);
    }
    if (bill) {
        const obs = await prisma.vendorPaymentObservation.findMany({ where: { billId: bill.id }});
        console.log("AP Obs:", obs.length);
    }
}
verify().catch(console.error).finally(() => process.exit(0));
