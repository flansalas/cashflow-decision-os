import prisma from "../src/db/prisma";
import { computeForecast, type ForecastInput, type ForecastInvoice, type ForecastBill } from "../src/services/forecast";
import { computeBaseline } from "../src/services/baseline";

async function run() {
    const companyId = "6f8b9b14-4b04-48dd-988b-4d28bef4ec16";
    const cashSnapshot = await prisma.cashSnapshot.findFirst({
        where: { companyId },
        orderBy: [{ asOfDate: 'desc' }, { createdAt: 'desc' }]
    });
    const cashAdjustments = await prisma.cashAdjustment.findMany({ where: { companyId } });
    const adjustmentsTotal = cashAdjustments.reduce((s, a) => s + a.amount, 0);
    const openingCash = cashSnapshot!.bankBalance + adjustmentsTotal;

    const invoicesRaw = await prisma.receivableInvoice.findMany({ where: { companyId } });
    const billsRaw = await prisma.payableBill.findMany({ where: { companyId } });
    const recurringPatternsRaw = await prisma.recurringPattern.findMany({ where: { companyId } });
    const assumptionsRaw = await prisma.assumption.findFirst({ where: { companyId } });

    const assumptions = assumptionsRaw || {
        bufferMin: 10000, fixedWeeklyOutflow: 0, payrollCadence: "biweekly",
        payrollAllInAmount: null, payrollNextDate: null, rentMonthlyAmount: null,
        rentDayOfMonth: null, paymentCurveJson: "{}", highRiskAgingDays: 61,
        projectionSafetyMargin: 1.0
    };

    const txs = await prisma.bankTransaction.findMany({
        where: { companyId }, orderBy: { txDate: 'desc' }, take: 1000
    });
    const bankTxsForBaseline = txs.map(t => ({ amount: t.amount, date: t.txDate, merchantKey: t.description }));
    const patternsForBaseline = recurringPatternsRaw.map(rp => ({
        merchantKey: rp.merchantKey ?? rp.displayName,
        direction: rp.direction,
        category: rp.category,
        isIncluded: rp.isIncluded,
        typicalAmount: rp.typicalAmount ?? 0,
        amountStdDev: rp.amountStdDev ?? 0,
    }));
    const baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, cashSnapshot!.asOfDate);
    const hasBankBaseline = baseline.hasSufficientHistory;

    const buildInput = (invs: ForecastInvoice[], bls: ForecastBill[]): ForecastInput => ({
        adjustedOpeningCash: openingCash,
        bankBalance: cashSnapshot!.bankBalance,
        adjustmentsTotal,
        asOfDate: cashSnapshot!.asOfDate,
        invoices: invs,
        bills: bls,
        recurring: recurringPatternsRaw.map(rp => ({ ...rp, direction: rp.direction as "inflow"|"outflow", confidence: rp.confidence as "high"|"med"|"low" })),
        assumptions: {
            bufferMin: assumptions.bufferMin ?? 10000,
            fixedWeeklyOutflow: assumptions.fixedWeeklyOutflow ?? 0,
            payrollCadence: assumptions.payrollCadence ?? "biweekly",
            payrollAllInAmount: assumptions.payrollAllInAmount ?? null,
            payrollNextDate: assumptions.payrollNextDate ?? null,
            rentMonthlyAmount: assumptions.rentMonthlyAmount ?? null,
            rentDayOfMonth: assumptions.rentDayOfMonth ?? null,
            paymentCurveJson: assumptions.paymentCurveJson || "{}",
            highRiskAgingDays: assumptions.highRiskAgingDays ?? 61,
            projectionSafetyMargin: assumptions.projectionSafetyMargin ?? 1.0,
        },
        hasBankBaseline,
        variableOutflowWeekly: baseline.variableOutflowWeekly,
        variableOutflowBand: baseline.variableOutflowBand,
        baselineInflowWeekly: baseline.variableInflowWeekly,
        baselineInflowBand: baseline.variableInflowBand,
        oneTimeOutflows: [],
    });

    const parsedInvs: ForecastInvoice[] = invoicesRaw.map(i => ({ ...i, markedPaid: false, overrideAmount: null, overrideExpectedDate: null, partialPayment: null, riskTag: undefined, typicalDelayWeeks: undefined } as ForecastInvoice));
    const parsedBills: ForecastBill[] = billsRaw.map(b => ({ ...b, markedPaid: false, overrideAmount: null, overrideDueDate: null, criticality: undefined } as ForecastBill));

    // Run baseline forecast
    const inputBase = buildInput(parsedInvs, parsedBills);
    const fcBase = computeForecast(inputBase);
    
    const w1InvoiceItem = fcBase.weeks[0].breakdown.inflows.find(i => i.sourceType === "invoice" && i.amount > 0);
    
    if (w1InvoiceItem && w1InvoiceItem.sourceId) {
        const w1Invoice = parsedInvs.find(i => i.id === w1InvoiceItem.sourceId);
        if (w1Invoice) {
            const d = new Date(w1Invoice.overrideExpectedDate || w1Invoice.dueDate || w1Invoice.invoiceDate || cashSnapshot!.asOfDate);
            d.setDate(d.getDate() + 7);
            const newInvs = parsedInvs.map(i => i.id === w1Invoice.id ? { ...i, overrideExpectedDate: d } : i);
            const fcAR = computeForecast(buildInput(newInvs, parsedBills));
            
            const w1BaseStart = fcBase.weeks[0].startCash;
            const w1BaseEnd = fcBase.weeks[0].endCashExpected;
            const w2BaseStart = fcBase.weeks[1].startCash;
            
            const w1ARStart = fcAR.weeks[0].startCash;
            const w1AREnd = fcAR.weeks[0].endCashExpected;
            const w2ARStart = fcAR.weeks[1].startCash;
            
            console.log("AR Move Test:");
            console.log(`W1 Start: ${w1BaseStart} -> ${w1ARStart} (Passed: ${w1ARStart === w1BaseStart})`);
            console.log(`W1 End: ${w1BaseEnd} -> ${w1AREnd} (Passed: ${w1AREnd === w1BaseEnd - w1InvoiceItem.amount})`);
            console.log(`W2 Start: ${w2BaseStart} -> ${w2ARStart} (Passed: ${w2ARStart === w2BaseStart - w1InvoiceItem.amount})`);

            // Exclude test
            const excInvs = parsedInvs.filter(i => i.id !== w1Invoice.id);
            const fcExc = computeForecast(buildInput(excInvs, parsedBills));
            console.log("AR Exclude Test:");
            console.log(`W1 Start: ${fcExc.weeks[0].startCash} (Passed: ${fcExc.weeks[0].startCash === w1BaseStart})`);
            console.log(`W1 End: ${fcExc.weeks[0].endCashExpected} (Passed: ${fcExc.weeks[0].endCashExpected === w1BaseEnd - w1InvoiceItem.amount})`);
            console.log(`W2 Start: ${fcExc.weeks[1].startCash} (Passed: ${fcExc.weeks[1].startCash === w2BaseStart - w1InvoiceItem.amount})`);
        }
    } else {
        console.log("No W1 AR found for test");
    }

    const w1BillItem = fcBase.weeks[0].breakdown.outflows.find(i => i.sourceType === "bill" && i.amount > 0);

    if (w1BillItem && w1BillItem.sourceId) {
        const w1Bill = parsedBills.find(b => b.id === w1BillItem.sourceId);
        if (w1Bill) {
            const d = new Date(w1Bill.overrideDueDate || w1Bill.dueDate || w1Bill.billDate || cashSnapshot!.asOfDate);
            d.setDate(d.getDate() + 7);
            const newBills = parsedBills.map(b => b.id === w1Bill.id ? { ...b, overrideDueDate: d } : b);
            const fcAP = computeForecast(buildInput(parsedInvs, newBills));
            
            const w1BaseStart = fcBase.weeks[0].startCash;
            const w1BaseEnd = fcBase.weeks[0].endCashExpected;
            const w2BaseStart = fcBase.weeks[1].startCash;
            
            const w1APStart = fcAP.weeks[0].startCash;
            const w1APEnd = fcAP.weeks[0].endCashExpected;
            const w2APStart = fcAP.weeks[1].startCash;

            console.log("AP Move Test:");
            console.log(`W1 Start: ${w1BaseStart} -> ${w1APStart} (Passed: ${w1APStart === w1BaseStart})`);
            console.log(`W1 End: ${w1BaseEnd} -> ${w1APEnd} (Passed: ${w1APEnd === w1BaseEnd + w1BillItem.amount})`);
            console.log(`W2 Start: ${w2BaseStart} -> ${w2APStart} (Passed: ${w2APStart === w2BaseStart + w1BillItem.amount})`);
        }
    } else {
        console.log("No W1 AP found for test");
    }
}
run();
