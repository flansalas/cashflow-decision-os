import prisma from "@/db/prisma";
import { computeForecast, type ForecastInput, type ForecastInvoice, type ForecastBill, type ForecastRecurring } from "@/services/forecast";
import { computeBaseline, type BankTxForBaseline, type RecurringPatternForBaseline } from "@/services/baseline";
import { getCanonicalBaselineInputs } from "@/services/baseline-fetch";
import { computeTypicalDelayWeeks } from "@/services/payment-memory";
import { computeCOGSCorrelation } from "@/services/cogs-correlation";
import { computeVarianceMultipliers } from "@/services/variance";

export async function assembleForecastData(companyId: string) {
    const [
        cashSnapshot,
        cashAdjustments,
        invoicesRaw,
        billsRaw,
        customerProfiles,
        vendorProfiles,
        assumptionRaw,
        overrides,
        companyNotes,
        cashFlowCategories,
        cashFlowEntries,
        varianceLedger,
        customerPaymentObs,
        reconciliationLinks,
    ] = await Promise.all([
        prisma.cashSnapshot.findFirst({ where: { companyId }, orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }] }),
        prisma.cashAdjustment.findMany({ where: { companyId } }),
        prisma.receivableInvoice.findMany({ where: { companyId } }),
        prisma.payableBill.findMany({ where: { companyId } }),
        prisma.customerProfile.findMany({ where: { companyId } }),
        prisma.vendorProfile.findMany({ where: { companyId } }),
        prisma.assumption.findFirst({ where: { companyId } }),
        prisma.override.findMany({ where: { companyId, status: "active" }, orderBy: { createdAt: "desc" } }),
        prisma.companyNote.findMany({ where: { companyId } }),
        prisma.cashFlowCategory.findMany({ where: { companyId }, orderBy: [{ direction: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
        prisma.cashFlowEntry.findMany({ where: { companyId }, include: { category: true } }),
        prisma.baselineVarianceLedger.findMany({
            where: { companyId },
            orderBy: { weekStart: "desc" },
            take: 8,
        }),
        prisma.customerPaymentObservation.findMany({
            where: { companyId },
            select: { customerName: true, daysEarlyOrLate: true },
        }),
        prisma.reconciliationLink.findMany({
            where: { companyId, status: "active" },
        }),
    ]);

    if (!cashSnapshot) {
        throw new Error("No cash snapshot found");
    }

    const { recurringPatternsRaw, bankTxsForBaseline, patternsForBaseline } = await getCanonicalBaselineInputs(companyId);

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

    const baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, cashSnapshot.asOfDate, {
        payrollAllInAmount: assumptions.payrollAllInAmount,
        payrollNextDate: assumptions.payrollNextDate,
        payrollCadence: assumptions.payrollCadence,
        rentMonthlyAmount: assumptions.rentMonthlyAmount,
        rentDayOfMonth: assumptions.rentDayOfMonth,
    });

    const cogsCorrelation = computeCOGSCorrelation(baseline.weeklyBuckets);

    const multipliers = computeVarianceMultipliers(varianceLedger);
    const varianceMultiplier = multipliers.outflow;
    const varianceMultiplierIn = multipliers.inflow;

    // We apply multipliers inline when building the forecast inputs.

    const customerMap = new Map(customerProfiles.map(c => [c.customerName, c]));
    const vendorMap = new Map(vendorProfiles.map(v => [v.vendorName, v]));

    // Auto-populate typicalDelayWeeks from payment observations if not manually set
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

    const deductions = new Map<string, number>();
    for (const link of reconciliationLinks) {
        if (link.status !== "active") continue;
        const matchedAmount = Number(link.matchedAmount);
        if (matchedAmount <= 0) continue;
        
        if (link.deductFrom === "source") {
            deductions.set(link.sourceId, (deductions.get(link.sourceId) || 0) + matchedAmount);
        } else if (link.deductFrom === "target") {
            deductions.set(link.targetId, (deductions.get(link.targetId) || 0) + matchedAmount);
        }
        // If deductFrom is null/undefined or something else, it is unresolved and does not change forecast.
    }

    const invoices: ForecastInvoice[] = invoicesRaw.map(inv => {
        const cp = customerMap.get(inv.customerName);
        const ovs = overridesByTarget.get(inv.id) || [];
        let markedPaid = false, overrideExpectedDate: Date | null = null, overrideAmount: number | null = null, partialPayment: number | null = null, isExcluded = false;
        for (const ov of ovs) {
            if (ov.type === "mark_paid") markedPaid = true;
            if (ov.type === "exclude") isExcluded = true;
            if (ov.type === "set_expected_payment_date" && ov.effectiveDate) overrideExpectedDate = ov.effectiveDate;
            if (ov.type === "adjust_amount" && ov.amount != null) overrideAmount = ov.amount;
            if (ov.type === "partial_payment" && ov.amount != null) partialPayment = ov.amount;
        }
        if (isExcluded) return null;
        const ded = deductions.get(inv.id) || 0;
        const remainder = Math.max(0, inv.amountOpen - ded);
        if (remainder === 0 && !markedPaid) return null; // Fully covered by other records
        return {
            id: inv.id, customerName: inv.customerName, invoiceNo: inv.invoiceNo, amountOpen: remainder, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate, daysPastDue: inv.daysPastDue, status: inv.status, metaJson: inv.metaJson, typicalDelayWeeks: cp?.typicalDelayWeeks ?? computeTypicalDelayWeeks(obsByCustomer.get(inv.customerName) || []) ?? computeTypicalDelayWeeks(customerPaymentObs), riskTag: cp?.riskTag, overrideExpectedDate, overrideAmount, markedPaid, partialPayment,
        };
    }).filter((inv): inv is NonNullable<typeof inv> => inv !== null);

    const bills: ForecastBill[] = billsRaw.map(bill => {
        const vp = vendorMap.get(bill.vendorName);
        const ovs = overridesByTarget.get(bill.id) || [];
        let markedPaid = false, overrideDueDate: Date | null = null, overrideAmount: number | null = null, isExcluded = false;
        for (const ov of ovs) {
            if (ov.type === "mark_paid") markedPaid = true;
            if (ov.type === "exclude") isExcluded = true;
            if (ov.type === "delay_due_date" && ov.effectiveDate) overrideDueDate = ov.effectiveDate;
            if (ov.type === "set_bill_due_date" && ov.effectiveDate) overrideDueDate = ov.effectiveDate;
            if (ov.type === "adjust_amount" && ov.amount != null) overrideAmount = ov.amount;
        }
        if (isExcluded) return null;
        const ded = deductions.get(bill.id) || 0;
        const remainder = Math.max(0, bill.amountOpen - ded);
        if (remainder === 0 && !markedPaid) return null;
        return {
            id: bill.id, vendorName: bill.vendorName, billNo: bill.billNo, amountOpen: remainder, billDate: bill.billDate, dueDate: bill.dueDate, daysPastDue: bill.daysPastDue, status: bill.status, criticality: vp?.criticality, overrideDueDate, overrideAmount, markedPaid, expenseClass: (bill as any).expenseClass,
        };
    }).filter((bill): bill is NonNullable<typeof bill> => bill !== null);

    const skipDatesByPattern = new Map<string, string[]>();
    for (const ov of overrides) {
        if (ov.type === "skip_recurring_occurrence" && ov.targetId && ov.effectiveDate) {
            if (!skipDatesByPattern.has(ov.targetId)) skipDatesByPattern.set(ov.targetId, []);
            skipDatesByPattern.get(ov.targetId)!.push(ov.effectiveDate.toISOString().slice(0, 10));
        }
    }

    const recurring: ForecastRecurring[] = recurringPatternsRaw.map(rp => ({
        id: rp.id, direction: rp.direction as "inflow" | "outflow", displayName: rp.displayName, typicalAmount: rp.typicalAmount, amountStdDev: rp.amountStdDev, cadence: rp.cadence, nextExpectedDate: rp.nextExpectedDate, confidence: rp.confidence as "high" | "med" | "low", category: rp.category, isIncluded: rp.isIncluded, isCritical: rp.isCritical, status: rp.status, origin: rp.origin,
        skipDates: skipDatesByPattern.get(rp.id) ?? [],
    })).filter(rp => rp.isIncluded);

    // Apply adjust_amount overrides to recurring
    for (const r of recurring) {
        const ovs = overridesByTarget.get(r.id) || [];
        const adj = ovs.find(o => o.type === "adjust_amount");
        if (adj && adj.amount != null) {
            r.typicalAmount = adj.amount;
        }
    }

    
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

    const bankBalance = cashSnapshot.bankBalance;
    const pastAdjustments = cashAdjustments.filter(a => a.origin === "system");
    const futureAdjustments = cashAdjustments.filter(a => a.origin === "user");
    
    const adjustmentsTotal = pastAdjustments.reduce((s, a) => s + a.amount, 0);
    const adjustedOpeningCash = bankBalance + adjustmentsTotal;

    const totalOpenAR = invoicesRaw.reduce((s, i) => s + i.amountOpen, 0);
    const isARHeavy = totalOpenAR > (baseline.variableInflowWeekly || 0);

    const mappedFutureAdjustments = futureAdjustments.map(a => {
        const ded = deductions.get(a.id) || 0;
        const remainder = Math.max(0, Math.abs(a.amount) - ded);
        if (remainder === 0) return null;
        return {
            categoryId: "custom",
            categoryName: a.type,
            direction: a.amount >= 0 ? ("inflow" as const) : ("outflow" as const),
            label: a.note || a.type,
            amount: remainder,
            targetDate: a.effectiveDate,
            sourceId: a.id,
        };
    }).filter((a): a is NonNullable<typeof a> => a !== null);

    const mappedEntries = cashFlowEntries.map((e: any) => {
        const ded = deductions.get(e.id) || 0;
        const remainder = Math.max(0, e.amount - ded);
        if (remainder === 0) return null;
        return {
            categoryId: e.categoryId,
            categoryName: e.category.name,
            direction: e.category.direction as "inflow" | "outflow",
            label: e.label,
            amount: remainder,
            targetDate: e.targetDate,
            sourceId: e.id,
        };
    }).filter((e): e is NonNullable<typeof e> => e !== null);

    const input: ForecastInput = {
        adjustedOpeningCash,
        bankBalance,
        adjustmentsTotal,
        asOfDate: cashSnapshot.asOfDate,
        invoices,
        bills,
        recurring,
        assumptions: {
            bufferMin: assumptions.bufferMin ?? 10000,
            fixedWeeklyOutflow: assumptions.fixedWeeklyOutflow ?? 0,
            payrollCadence: assumptions.payrollCadence ?? "biweekly",
            payrollAllInAmount: assumptions.payrollAllInAmount ?? null,
            payrollNextDate: assumptions.payrollNextDate ?? null,
            rentMonthlyAmount: assumptions.rentMonthlyAmount ?? null,
            rentDayOfMonth: assumptions.rentDayOfMonth ?? null,
            paymentCurveJson: assumptions.paymentCurveJson,
            highRiskAgingDays: assumptions.highRiskAgingDays ?? 61,
            projectionSafetyMargin: assumptions.projectionSafetyMargin ?? 1.0,
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
        cashFlowEntries: [...mappedEntries, ...mappedFutureAdjustments]
    };


    const forecastResult = computeForecast(input);

    const organicInvoices: ForecastInvoice[] = invoicesRaw.map(inv => {
        const cp = customerMap.get(inv.customerName);
        const ovs = overridesByTarget.get(inv.id) || [];
        let markedPaid = false, overrideAmount: number | null = null, partialPayment: number | null = null, isExcluded = false;
        for (const ov of ovs) {
            if (ov.type === "mark_paid") markedPaid = true;
            if (ov.type === "exclude") isExcluded = true;
            if (ov.type === "adjust_amount" && ov.amount != null) overrideAmount = ov.amount;
            if (ov.type === "partial_payment" && ov.amount != null) partialPayment = ov.amount;
        }
        if (isExcluded) return null;
        return {
            id: inv.id, customerName: inv.customerName, invoiceNo: inv.invoiceNo, amountOpen: inv.amountOpen, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate, daysPastDue: inv.daysPastDue, status: inv.status, metaJson: inv.metaJson, typicalDelayWeeks: cp?.typicalDelayWeeks ?? computeTypicalDelayWeeks(obsByCustomer.get(inv.customerName) || []) ?? computeTypicalDelayWeeks(customerPaymentObs), riskTag: cp?.riskTag, overrideExpectedDate: null, overrideAmount, markedPaid, partialPayment,
        };
    }).filter((inv): inv is NonNullable<typeof inv> => inv !== null);

    const organicBills: ForecastBill[] = billsRaw.map(bill => {
        const vp = vendorMap.get(bill.vendorName);
        const ovs = overridesByTarget.get(bill.id) || [];
        let markedPaid = false, overrideAmount: number | null = null, isExcluded = false;
        for (const ov of ovs) {
            if (ov.type === "mark_paid") markedPaid = true;
            if (ov.type === "exclude") isExcluded = true;
            if (ov.type === "adjust_amount" && ov.amount != null) overrideAmount = ov.amount;
        }
        if (isExcluded) return null;
        return {
            id: bill.id, vendorName: bill.vendorName, billNo: bill.billNo, amountOpen: bill.amountOpen, billDate: bill.billDate, dueDate: bill.dueDate, daysPastDue: bill.daysPastDue, status: bill.status, criticality: vp?.criticality, overrideDueDate: null, overrideAmount, markedPaid, expenseClass: (bill as any).expenseClass,
        };
    }).filter((bill): bill is NonNullable<typeof bill> => bill !== null);

    const organicRecurring: ForecastRecurring[] = recurringPatternsRaw.map(rp => ({
        id: rp.id, direction: rp.direction as "inflow" | "outflow", displayName: rp.displayName, typicalAmount: rp.typicalAmount, amountStdDev: rp.amountStdDev, cadence: rp.cadence, nextExpectedDate: rp.nextExpectedDate, confidence: rp.confidence as "high" | "med" | "low", category: rp.category, isIncluded: rp.isIncluded, isCritical: rp.isCritical, status: rp.status, origin: rp.origin,
        skipDates: []
    })).filter(rp => rp.isIncluded);
    for (const r of organicRecurring) {
        const ovs = overridesByTarget.get(r.id) || [];
        const adj = ovs.find(o => o.type === "adjust_amount");
        if (adj && adj.amount != null) {
            r.typicalAmount = adj.amount;
        }
    }

    const organicInput: ForecastInput = {
        ...input,
        invoices: organicInvoices,
        bills: organicBills,
        recurring: organicRecurring,
        oneTimeOutflows: []
    };

    const organicForecast = computeForecast(organicInput);

    return { input, forecastResult, organicForecast, baseline, overrides, invoices, bills, recurring, cashSnapshot, cashAdjustments, companyNotes, cashFlowCategories, cashFlowEntries, assumptions };
}
