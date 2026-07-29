import prisma from "../src/db/prisma";
import { computeForecast, type ForecastInput } from "../src/services/forecast";
import { detectAnomalies, computeConfidence, computeDataQualityGate, type QAInput } from "../src/services/qa";
import { generateActions } from "../src/services/actions";
import { computeBaseline } from "../src/services/baseline";
import fs from "fs";

async function run() {
    const companyId = "6f8b9b14-4b04-48dd-988b-4d28bef4ec16";

    // Replicating GET /api/dashboard logic
    const cashSnapshot = await prisma.cashSnapshot.findFirst({
        where: { companyId },
        orderBy: [{ asOfDate: 'desc' }, { createdAt: 'desc' }]
    });
    const cashAdjustments = await prisma.cashAdjustment.findMany({
        where: { companyId }
    });
    const companyNotes = await prisma.companyNote.findMany({
        where: { companyId }
    });
    const invoicesRaw = await prisma.receivableInvoice.findMany({
        where: { companyId, }
    });
    const billsRaw = await prisma.payableBill.findMany({
        where: { companyId, }
    });
    const recurringPatternsRaw = await prisma.recurringPattern.findMany({
        where: { companyId }
    });
    const assumptionsRaw = await prisma.assumption.findFirst({
        where: { companyId }
    });
    const assumptions = assumptionsRaw || {
        bufferMin: 10000,
        fixedWeeklyOutflow: 0,
        payrollCadence: "biweekly",
        payrollAllInAmount: null,
        payrollNextDate: null,
        rentMonthlyAmount: null,
        rentDayOfMonth: null,
        paymentCurveJson: "{}",
        highRiskAgingDays: 61,
        projectionSafetyMargin: 1.0
    };

    const overrides = await prisma.override.findMany({
        where: { companyId }
    });

    const activeInvoiceOverrides = overrides.filter(ov => ov.type === "exclude_invoice" && ov.targetId);
    const activeBillOverrides = overrides.filter(ov => ov.type === "exclude_bill" && ov.targetId);

    const excludedInvoiceIds = new Set(activeInvoiceOverrides.map(o => o.targetId));
    const excludedBillIds = new Set(activeBillOverrides.map(o => o.targetId));

    const invoices = invoicesRaw.filter(i => !excludedInvoiceIds.has(i.id));
    const bills = billsRaw.filter(b => !excludedBillIds.has(b.id));

    const oneTimeOutflows = overrides
        .filter(ov => ov.type === "add_one_time_outflow" && ov.targetId && ov.effectiveDate && ov.amount != null && ov.metaJson?.startsWith("recurring:"))
        .map(ov => {
            const parts = ov.metaJson!.split("|from:");
            return {
                patternId: ov.targetId!,
                displayName: parts[0].replace("recurring:", ""),
                amount: ov.amount!,
                weekStart: ov.effectiveDate!,
                sourceWeekStart: parts[1] || null,
            };
        });

    const txs = await prisma.bankTransaction.findMany({
        where: { companyId },
        orderBy: { txDate: 'desc' },
        take: 1000
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

    const adjustmentsTotal = cashAdjustments.reduce((s, a) => s + a.amount, 0);
    const openingCash = cashSnapshot!.bankBalance + adjustmentsTotal;

    const forecastInput: ForecastInput = {
        adjustedOpeningCash: openingCash,
        bankBalance: cashSnapshot!.bankBalance,
        adjustmentsTotal,
        asOfDate: cashSnapshot!.asOfDate,
        invoices,
        bills,
        recurring: recurringPatternsRaw.map(rp => ({
            ...rp,
            direction: rp.direction as "inflow" | "outflow",
            confidence: rp.confidence as "high" | "med" | "low"
        })),
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
        oneTimeOutflows,
    };

    const forecastResult = computeForecast(forecastInput);

    const payrollPattern = recurringPatternsRaw.find(
        rp => rp.category === "payroll" && rp.isIncluded
    );

    const qaInput: QAInput = {
        invoices: invoicesRaw.map(i => ({
            id: i.id,
            customerName: i.customerName,
            invoiceNo: i.invoiceNo,
            amountOpen: i.amountOpen,
            invoiceDate: i.invoiceDate,
            dueDate: i.dueDate,
            daysPastDue: i.daysPastDue,
        })),
        bills: billsRaw.map(b => ({
            id: b.id,
            vendorName: b.vendorName,
            billNo: b.billNo,
            amountOpen: b.amountOpen,
            billDate: b.billDate,
            dueDate: b.dueDate,
        })),
        assumptions: {
            payrollAllInAmount: assumptions.payrollAllInAmount,
            payrollNextDate: assumptions.payrollNextDate,
        },
        payrollPatternDetected: !!payrollPattern,
        payrollPatternConfidence: payrollPattern ? payrollPattern.confidence as "high" | "med" | "low" : null,
        hasBankData: bankTxsForBaseline.length > 0,
        arRefreshDate: (() => {
            const note = companyNotes.find(n => n.noteText.startsWith("ar_refresh_at:"));
            if (!note) return null;
            const iso = note.noteText.slice("ar_refresh_at:".length);
            const d = new Date(iso);
            return isNaN(d.getTime()) ? null : d;
        })(),
        apRefreshDate: (() => {
            const note = companyNotes.find(n => n.noteText.startsWith("ap_refresh_at:"));
            if (!note) return null;
            const iso = note.noteText.slice("ap_refresh_at:".length);
            const d = new Date(iso);
            return isNaN(d.getTime()) ? null : d;
        })(),
        baseline,
        cashMismatchUnreconciled: companyNotes.some(n => n.noteText === "cash_mismatch_unreconciled"),
    };

    const anomalies = detectAnomalies(qaInput);
    const confidence = computeConfidence(qaInput, anomalies);
    const dataQualityGate = computeDataQualityGate(qaInput);

    const actions = generateActions({
        forecast: forecastResult,
        invoices,
        bills,
        bufferMin: assumptions.bufferMin ?? 10000,
        rawForecastInput: forecastInput,
    });

    const result = {
        snapshotDate: cashSnapshot!.asOfDate,
        startingCash: openingCash,
        hasBankBaseline,
        baseline: {
            inflow: baseline.variableInflowWeekly,
            outflow: baseline.variableOutflowWeekly,
            inflowBand: baseline.variableInflowBand,
            outflowBand: baseline.variableOutflowBand,
            note: baseline.note
        },
        forecast: forecastResult,
        anomalies,
        confidence,
        quality: dataQualityGate,
        actions
    };

    fs.writeFileSync("dashboard-old.json", JSON.stringify(result, null, 2));
    console.log("Saved dashboard-old.json");
}
run();
