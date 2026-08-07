
import { PrismaClient } from "@prisma/client";
import { computeForecast } from "../src/services/forecast";
import { computeBaseline } from "../src/services/baseline";
import { computeVarianceMultipliers } from "../src/services/variance";
import { computeCOGSCorrelation } from "../src/services/cogs-correlation";
import { computeExpectedPaymentDate, parsePaymentCurve, getMonday, addDays } from "../src/services/forecast";

import prisma from "../src/db/prisma";

async function main() {
    const cid = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
    const [
        cashSnapshot,
        cashAdjustments,
        invoicesRaw,
        billsRaw,
        customerProfiles,
        vendorProfiles,
        assumptionRaw,
        recurringPatternsRaw,
        overrides,
        bankTxs,
        companyNotes,
        cashFlowCategories,
        cashFlowEntries,
        varianceLedger,
        customerPaymentObs,
    ] = await Promise.all([
        prisma.cashSnapshot.findFirst({ where: { companyId: cid }, orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }] }),
        prisma.cashAdjustment.findMany({ where: { companyId: cid } }),
        prisma.receivableInvoice.findMany({ where: { companyId: cid } }),
        prisma.payableBill.findMany({ where: { companyId: cid } }),
        prisma.customerProfile.findMany({ where: { companyId: cid } }),
        prisma.vendorProfile.findMany({ where: { companyId: cid } }),
        prisma.assumption.findFirst({ where: { companyId: cid } }),
        prisma.recurringPattern.findMany({ where: { companyId: cid, status: "active" } }),
        prisma.override.findMany({ where: { companyId: cid, status: "active" }, orderBy: { createdAt: "desc" } }),
        prisma.bankTransaction.findMany({
            where: { companyId: cid },
            select: { amount: true, txDate: true, description: true, direction: true },
        }),
        prisma.companyNote.findMany({ where: { companyId: cid } }),
        prisma.cashFlowCategory.findMany({ where: { companyId: cid }, orderBy: [{ direction: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
        prisma.cashFlowEntry.findMany({ where: { companyId: cid }, include: { category: true } }),
        prisma.baselineVarianceLedger.findMany({
            where: { companyId: cid },
            orderBy: { weekStart: "desc" },
            take: 8,
        }),
        prisma.customerPaymentObservation.findMany({
            where: { companyId: cid },
            select: { customerName: true, daysEarlyOrLate: true },
        }),
    ]);

    const assumptions = assumptionRaw ?? {
        bufferMin: 10000,
        fixedWeeklyOutflow: 0,
        payrollCadence: "biweekly",
        payrollAllInAmount: null,
        payrollNextDate: null,
        rentMonthlyAmount: null,
        rentDayOfMonth: null,
        paymentCurveJson: '{"current":0,"1-14":1,"15-30":2,"31-60":3,"61+":4}',
        highRiskAgingDays: 61,
        projectionSafetyMargin: 1.0,
    };

    const cachedBaseline = await prisma.baselineSnapshot.findUnique({
        where: { companyId: cid }
    });

    let baseline: any;
    if (cachedBaseline) {
        baseline = {
            variableInflowWeekly: cachedBaseline.variableInflowWeekly,
            variableOutflowWeekly: cachedBaseline.variableOutflowWeekly,
            variableInflowBand: cachedBaseline.variableInflowBand,
            variableOutflowBand: cachedBaseline.variableOutflowBand,
            conservativeInflowWeekly: cachedBaseline.conservativeInflowWeekly,
            conservativeOutflowWeekly: cachedBaseline.conservativeOutflowWeekly,
            weeklyBuckets: JSON.parse(cachedBaseline.weeklyBucketsJson),
            hasSufficientHistory: cachedBaseline.hasSufficientHistory,
            baselineConfidenceTier: cachedBaseline.baselineConfidenceTier as any,
            inflowCadence: parseInt(cachedBaseline.inflowCadence || "1", 10),
            outflowCadence: parseInt(cachedBaseline.outflowCadence || "1", 10),
            weeksAnalyzed: 0,
            computedFrom: "bank_tx",
            note: "Loaded from cache",
            methodNote: "Cached",
        };
    }

    const cogsCorrelation = computeCOGSCorrelation(baseline.weeklyBuckets);
    const multipliers = computeVarianceMultipliers(varianceLedger);
    let varianceMultiplier = multipliers.outflow;
    let varianceMultiplierIn = multipliers.inflow;

    const customerMap = new Map(customerProfiles.map(c => [c.customerName, c]));
    const vendorMap = new Map(vendorProfiles.map(v => [v.vendorName, v]));
    const obsByCustomer = new Map<string, Array<{ daysEarlyOrLate: number }>>();
    for (const obs of customerPaymentObs) {
        if (!obsByCustomer.has(obs.customerName)) obsByCustomer.set(obs.customerName, []);
        obsByCustomer.get(obs.customerName)!.push(obs);
    }
    const overridesByTarget = new Map<string, typeof overrides>();
    for (const ov of overrides) {
        if (ov.targetId) {
            if (!overridesByTarget.has(ov.targetId)) overridesByTarget.set(ov.targetId, []);
            overridesByTarget.get(ov.targetId)!.push(ov);
        }
    }

    const invoices = invoicesRaw.map(inv => {
        const cp = customerMap.get(inv.customerName);
        const ovs = overridesByTarget.get(inv.id) || [];
        let markedPaid = false;
        let overrideExpectedDate: Date | null = null;
        let overrideAmount: number | null = null;
        let partialPayment: number | null = null;
        let isExcluded = false;
        for (const ov of ovs) {
            if (ov.type === "mark_paid") markedPaid = true;
            if (ov.type === "exclude") isExcluded = true;
            if (ov.type === "set_expected_payment_date" && ov.effectiveDate) overrideExpectedDate = ov.effectiveDate;
            if (ov.type === "adjust_amount" && ov.amount != null) overrideAmount = ov.amount;
            if (ov.type === "partial_payment" && ov.amount != null) partialPayment = ov.amount;
        }
        if (isExcluded) return null;
        return {
            id: inv.id,
            customerName: inv.customerName,
            invoiceNo: inv.invoiceNo,
            amountOpen: inv.amountOpen,
            invoiceDate: inv.invoiceDate,
            dueDate: inv.dueDate,
            daysPastDue: inv.daysPastDue,
            status: inv.status,
            metaJson: inv.metaJson,
            typicalDelayWeeks: cp?.typicalDelayWeeks,
            riskTag: cp?.riskTag,
            overrideExpectedDate,
            overrideAmount,
            markedPaid,
            partialPayment,
        };
    }).filter((inv) => inv !== null);

    const bills = billsRaw.map(bill => {
        const vp = vendorMap.get(bill.vendorName);
        const ovs = overridesByTarget.get(bill.id) || [];
        let markedPaid = false;
        let overrideDueDate: Date | null = null;
        let overrideAmount: number | null = null;
        let isExcluded = false;
        for (const ov of ovs) {
            if (ov.type === "mark_paid") markedPaid = true;
            if (ov.type === "exclude") isExcluded = true;
            if (ov.type === "delay_due_date" && ov.effectiveDate) overrideDueDate = ov.effectiveDate;
            if (ov.type === "set_bill_due_date" && ov.effectiveDate) overrideDueDate = ov.effectiveDate;
            if (ov.type === "adjust_amount" && ov.amount != null) overrideAmount = ov.amount;
        }
        if (isExcluded) return null;
        return {
            id: bill.id,
            vendorName: bill.vendorName,
            billNo: bill.billNo,
            amountOpen: bill.amountOpen,
            billDate: bill.billDate,
            dueDate: bill.dueDate,
            daysPastDue: bill.daysPastDue,
            status: bill.status,
            criticality: vp?.criticality,
            overrideDueDate,
            overrideAmount,
            markedPaid,
        };
    }).filter((bill) => bill !== null);

    const skipDatesByPattern = new Map<string, string[]>();
    for (const ov of overrides) {
        if ((ov.type === "skip_recurring_occurrence" || ov.type === "modify_recurring_occurrence") && ov.targetId && ov.effectiveDate) {
            if (!skipDatesByPattern.has(ov.targetId)) skipDatesByPattern.set(ov.targetId, []);
            skipDatesByPattern.get(ov.targetId)!.push(ov.effectiveDate.toISOString().slice(0, 10));
        }
    }

    const recurring = recurringPatternsRaw.map(rp => ({
        id: rp.id,
        direction: rp.direction as "inflow" | "outflow",
        displayName: rp.displayName,
        typicalAmount: rp.typicalAmount,
        amountStdDev: rp.amountStdDev,
        cadence: rp.cadence,
        nextExpectedDate: rp.nextExpectedDate,
        confidence: rp.confidence as "high" | "med" | "low",
        category: rp.category,
        isIncluded: rp.isIncluded,
        isCritical: rp.isCritical,
        status: rp.status,
        origin: rp.origin,
        description: rp.description,
        skipDates: skipDatesByPattern.get(rp.id) ?? [],
    }));

    const oneTimeOutflows = overrides
        .filter(ov => (ov.type === "add_one_time_outflow" || ov.type === "modify_recurring_occurrence") && ov.targetId && ov.effectiveDate && ov.amount != null)
        .map(ov => {
            let displayName = ov.type === "modify_recurring_occurrence" ? "Modified Amount" : "Rescheduled Amount";
            let sourceWeekStart = null;
            if (ov.metaJson?.startsWith("recurring:")) {
                const parts = ov.metaJson.split("|from:");
                displayName = parts[0].replace("recurring:", "");
                sourceWeekStart = parts[1] || null;
            }
            return {
                patternId: ov.targetId!,
                displayName,
                amount: ov.amount!,
                weekStart: ov.effectiveDate!,
                sourceWeekStart,
            };
        });

    const bankBalance = cashSnapshot!.bankBalance;
    const pastAdjustments = cashAdjustments.filter(a => a.origin === "system");
    const futureAdjustments = cashAdjustments.filter(a => a.origin === "user");
    const adjustmentsTotal = pastAdjustments.reduce((sum, a) => sum + a.amount, 0);
    const adjustedOpeningCash = bankBalance + adjustmentsTotal;

    const totalOpenAR = invoicesRaw.reduce((s, i) => s + i.amountOpen, 0);
    const isARHeavy = totalOpenAR > (baseline.variableInflowWeekly || 0);

    const forecastInput = {
        adjustedOpeningCash,
        bankBalance,
        adjustmentsTotal,
        asOfDate: cashSnapshot!.asOfDate,
        invoices,
        bills,
        recurring,
        assumptions: {
            bufferMin: assumptions.bufferMin,
            fixedWeeklyOutflow: assumptions.fixedWeeklyOutflow,
            payrollCadence: assumptions.payrollCadence,
            payrollAllInAmount: assumptions.payrollAllInAmount,
            payrollNextDate: assumptions.payrollNextDate,
            rentMonthlyAmount: assumptions.rentMonthlyAmount,
            rentDayOfMonth: assumptions.rentDayOfMonth,
            paymentCurveJson: assumptions.paymentCurveJson,
            highRiskAgingDays: assumptions.highRiskAgingDays,
            projectionSafetyMargin: assumptions.projectionSafetyMargin,
        },
        hasBankBaseline: baseline.hasSufficientHistory,
        baselineConfidenceTier: baseline.baselineConfidenceTier,
        variableOutflowWeekly: baseline.variableOutflowWeekly * varianceMultiplier,
        variableOutflowBand: baseline.variableOutflowBand,
        baselineInflowWeekly: baseline.variableInflowWeekly * varianceMultiplierIn,
        baselineInflowBand: baseline.variableInflowBand,
        baselineInflowCadence: baseline.inflowCadence,
        baselineOutflowCadence: baseline.outflowCadence,
        cashMarginRatio: cogsCorrelation.cashMarginRatio,
        cogsLagWeeks: cogsCorrelation.cogsLagWeeks,
        isARHeavy,
        oneTimeOutflows,
        aiReasoningLog: undefined,
        aiInflowFactors: undefined,
        aiOutflowFactors: undefined,
        aiInflowExplanations: undefined,
        aiOutflowExplanations: undefined,
        cashFlowEntries: []
    };

    const forecast = computeForecast(forecastInput as any);
    
    console.log(JSON.stringify({
        deploymentSha: "e635048",
        inflowMultiplier: varianceMultiplierIn,
        outflowMultiplier: varianceMultiplier,
        rawM1InflowBaseline: baseline.variableInflowWeekly,
        rawM1OutflowBaseline: baseline.variableOutflowWeekly,
        postMultiplierInflow: forecastInput.baselineInflowWeekly,
        postMultiplierOutflow: forecastInput.variableOutflowWeekly,
        week1: {
            startCash: forecast.weeks[0].startCash,
            expectedInflow: forecast.weeks[0].inflowsExpected,
            expectedOutflow: forecast.weeks[0].outflowsExpected,
            endCash: forecast.weeks[0].endCashExpected
        },
        week13EndCash: forecast.weeks[12].endCashExpected
    }, null, 2));
}

main().catch(console.error);
