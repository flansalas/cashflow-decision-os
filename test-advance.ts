import 'dotenv/config';
import prisma from "./src/db/prisma";
async function run() {
    const cid = (await prisma.company.findFirst({ where: { name: { contains: "Cascio" } } }))!.id;
    const cashSnapshot = await prisma.cashSnapshot.findFirst({ where: { companyId: cid }, orderBy: { asOfDate: "desc" } });
    
    const [
        invoicesRaw, billsRaw, assumptionRaw, recurringPatternsRaw, cashFlowEntries
    ] = await Promise.all([
        prisma.receivableInvoice.findMany({ where: { companyId: cid } }),
        prisma.payableBill.findMany({ where: { companyId: cid } }),
        prisma.assumption.findFirst({ where: { companyId: cid } }),
        prisma.recurringPattern.findMany({ where: { companyId: cid } }),
        prisma.cashFlowEntry.findMany({ where: { companyId: cid }, include: { category: true } }),
    ]);

    const mapped = cashFlowEntries.map((e: any) => ({
        categoryId: e.categoryId,
        categoryName: e.category.name,
        direction: e.category.direction,
        label: e.label,
        amount: e.amount,
        targetDate: e.targetDate,
    }));
    
    // ADVANCE THE WEEK!
    const testDate = new Date(cashSnapshot!.asOfDate);
    testDate.setDate(testDate.getDate() + 7);
    
    const { computeForecast } = await import("./src/services/forecast");
    try {
        computeForecast({
            adjustedOpeningCash: 1000, bankBalance: 1000, adjustmentsTotal: 0,
            asOfDate: testDate,
            invoices: invoicesRaw.map((i: any) => ({ ...i, status: 'open' })),
            bills: billsRaw.map((b: any) => ({ ...b, status: 'open' })),
            recurring: recurringPatternsRaw as any[],
            assumptions: assumptionRaw || { bufferMin: 1000, paymentCurveJson: '{}' } as any,
            hasBankBaseline: false, variableOutflowWeekly: 0, variableOutflowBand: 0,
            baselineInflowWeekly: 0, baselineInflowBand: 0,
            cashFlowEntries: mapped,
        });
        console.log("Success computeForecast (+1 week)");
    } catch(err) {
        console.log("FAILED computeForecast", err);
    }
}
run();
