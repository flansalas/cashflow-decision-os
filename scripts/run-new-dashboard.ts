import { assembleForecastData } from "../src/services/forecast-assembly";
import { detectAnomalies, computeConfidence, computeDataQualityGate, type QAInput } from "../src/services/qa";
import { generateActions } from "../src/services/actions";
import fs from "fs";

async function run() {
    const companyId = "6f8b9b14-4b04-48dd-988b-4d28bef4ec16";
    const assembly = await assembleForecastData(companyId);

    const { input, forecastResult, baseline, overrides, invoices, bills, recurring, cashSnapshot, cashAdjustments, companyNotes, assumptions } = assembly;

    const hasBankBaseline = baseline.hasSufficientHistory;

    const payrollPattern = recurring.find(
        rp => rp.category === "payroll" && rp.isIncluded
    );

    const qaInput: QAInput = {
        invoices: invoices.map(i => ({
            id: i.id,
            customerName: i.customerName,
            invoiceNo: i.invoiceNo,
            amountOpen: i.amountOpen,
            invoiceDate: i.invoiceDate,
            dueDate: i.dueDate,
            daysPastDue: i.daysPastDue,
        })),
        bills: bills.map(b => ({
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
        hasBankData: baseline.weeksAnalyzed > 0,
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
    const quality = computeDataQualityGate(qaInput);
    const confidence = computeConfidence(qaInput, anomalies);

    const actions = generateActions({
        forecast: forecastResult,
        invoices,
        bills,
        bufferMin: assumptions.bufferMin,
        rawForecastInput: input,
    });

    const result = {
        snapshotDate: cashSnapshot.asOfDate,
        startingCash: input.adjustedOpeningCash,
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
        quality,
        actions
    };

    fs.writeFileSync("dashboard-new.json", JSON.stringify(result, null, 2));
    console.log("Saved dashboard-new.json");
}
run();
