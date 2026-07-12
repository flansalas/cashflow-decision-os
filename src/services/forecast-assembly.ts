import prisma from "@/db/prisma";
import { computeForecast, type ForecastInput, type ForecastInvoice, type ForecastBill, type ForecastRecurring } from "@/services/forecast";
import { computeBaseline, type BankTxForBaseline, type RecurringPatternForBaseline } from "@/services/baseline";

export async function assembleForecastData(companyId: string) {
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
    ] = await Promise.all([
        prisma.cashSnapshot.findFirst({ where: { companyId }, orderBy: { asOfDate: "desc" } }),
        prisma.cashAdjustment.findMany({ where: { companyId } }),
        prisma.receivableInvoice.findMany({ where: { companyId } }),
        prisma.payableBill.findMany({ where: { companyId } }),
        prisma.customerProfile.findMany({ where: { companyId } }),
        prisma.vendorProfile.findMany({ where: { companyId } }),
        prisma.assumption.findFirst({ where: { companyId } }),
        prisma.recurringPattern.findMany({ where: { companyId } }),
        prisma.override.findMany({ where: { companyId, status: "active" }, orderBy: { createdAt: "desc" } }),
        prisma.bankTransaction.findMany({
            where: {
                companyId,
                txDate: { gte: new Date(Date.now() - 84 * 86_400_000) },
            },
            select: { amount: true, txDate: true, description: true, direction: true },
        }),
        prisma.companyNote.findMany({ where: { companyId } }),
        prisma.cashFlowCategory.findMany({ where: { companyId }, orderBy: [{ direction: "asc" }, { sortOrder: "asc" }, { name: "asc" }] }),
        prisma.cashFlowEntry.findMany({ where: { companyId }, include: { category: true } }),
        prisma.baselineVarianceLedger.findMany({
            where: { companyId },
            orderBy: { weekStart: "desc" },
            take: 4,
        }),
    ]);

    if (!cashSnapshot) {
        throw new Error("No cash snapshot found");
    }

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

    const bankTxsForBaseline: BankTxForBaseline[] = bankTxs.map(tx => ({
        amount: tx.direction === "inflow" ? tx.amount : -tx.amount,
        date: tx.txDate,
        merchantKey: tx.description ?? "",
    }));

    const patternsForBaseline: RecurringPatternForBaseline[] = recurringPatternsRaw.map(rp => ({
        merchantKey: rp.merchantKey ?? rp.displayName,
        direction: rp.direction,
        category: rp.category,
        isIncluded: rp.isIncluded,
        typicalAmount: rp.typicalAmount,
        amountStdDev: rp.amountStdDev,
    }));

    const baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, cashSnapshot.asOfDate, {
        payrollAllInAmount: assumptions.payrollAllInAmount,
        payrollNextDate: assumptions.payrollNextDate,
        payrollCadence: assumptions.payrollCadence,
        rentMonthlyAmount: assumptions.rentMonthlyAmount,
        rentDayOfMonth: assumptions.rentDayOfMonth,
    });

    let varianceMultiplier = 1.0;
    let varianceMultiplierIn = 1.0;

    if (varianceLedger.length > 0) {
        const averageVariancePct = varianceLedger.reduce((sum, v) => sum + v.variancePct, 0) / varianceLedger.length;
        varianceMultiplier = 1 + averageVariancePct;
        baseline.variableOutflowWeekly = baseline.variableOutflowWeekly * varianceMultiplier;

        const inflowVariances = varianceLedger.filter(v => v.variancePctIn !== null);
        if (inflowVariances.length > 0) {
            const averageVariancePctIn = inflowVariances.reduce((sum, v) => sum + v.variancePctIn!, 0) / inflowVariances.length;
            varianceMultiplierIn = 1 + averageVariancePctIn;
            baseline.variableInflowWeekly = baseline.variableInflowWeekly * varianceMultiplierIn;
        }
    }

    const customerMap = new Map(customerProfiles.map(c => [c.customerName, c]));
    const vendorMap = new Map(vendorProfiles.map(v => [v.vendorName, v]));

    const overridesByTarget = new Map<string, typeof overrides>();
    for (const ov of overrides) {
        if (ov.targetId) {
            if (!overridesByTarget.has(ov.targetId)) overridesByTarget.set(ov.targetId, []);
            overridesByTarget.get(ov.targetId)!.push(ov);
        }
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
        return {
            id: inv.id, customerName: inv.customerName, invoiceNo: inv.invoiceNo, amountOpen: inv.amountOpen, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate, daysPastDue: inv.daysPastDue, status: inv.status, metaJson: inv.metaJson, typicalDelayWeeks: cp?.typicalDelayWeeks, riskTag: cp?.riskTag, overrideExpectedDate, overrideAmount, markedPaid, partialPayment,
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
        return {
            id: bill.id, vendorName: bill.vendorName, billNo: bill.billNo, amountOpen: bill.amountOpen, billDate: bill.billDate, dueDate: bill.dueDate, daysPastDue: bill.daysPastDue, status: bill.status, criticality: vp?.criticality, overrideDueDate, overrideAmount, markedPaid,
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
        id: rp.id, direction: rp.direction as "inflow" | "outflow", displayName: rp.displayName, typicalAmount: rp.typicalAmount, amountStdDev: rp.amountStdDev, cadence: rp.cadence, nextExpectedDate: rp.nextExpectedDate, confidence: rp.confidence as "high" | "med" | "low", category: rp.category, isIncluded: rp.isIncluded, isCritical: rp.isCritical,
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
    const adjustmentsTotal = cashAdjustments.reduce((s, a) => s + a.amount, 0);

    const input: ForecastInput = {
        adjustedOpeningCash: bankBalance + adjustmentsTotal,
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
        variableOutflowWeekly: baseline.variableOutflowWeekly,
        variableOutflowBand: baseline.variableOutflowBand,
        baselineInflowWeekly: baseline.variableInflowWeekly,
        baselineInflowBand: baseline.variableInflowBand,
        oneTimeOutflows,
        cashFlowEntries: cashFlowEntries.map((e: any) => ({
            categoryId: e.categoryId,
            categoryName: e.category.name,
            direction: e.category.direction as "inflow" | "outflow",
            label: e.label,
            amount: e.amount,
            targetDate: e.targetDate,
        }))
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
            id: inv.id, customerName: inv.customerName, invoiceNo: inv.invoiceNo, amountOpen: inv.amountOpen, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate, daysPastDue: inv.daysPastDue, status: inv.status, metaJson: inv.metaJson, typicalDelayWeeks: cp?.typicalDelayWeeks, riskTag: cp?.riskTag, overrideExpectedDate: null, overrideAmount, markedPaid, partialPayment,
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
            id: bill.id, vendorName: bill.vendorName, billNo: bill.billNo, amountOpen: bill.amountOpen, billDate: bill.billDate, dueDate: bill.dueDate, daysPastDue: bill.daysPastDue, status: bill.status, criticality: vp?.criticality, overrideDueDate: null, overrideAmount, markedPaid,
        };
    }).filter((bill): bill is NonNullable<typeof bill> => bill !== null);

    const organicRecurring: ForecastRecurring[] = recurringPatternsRaw.map(rp => ({
        id: rp.id, direction: rp.direction as "inflow" | "outflow", displayName: rp.displayName, typicalAmount: rp.typicalAmount, amountStdDev: rp.amountStdDev, cadence: rp.cadence, nextExpectedDate: rp.nextExpectedDate, confidence: rp.confidence as "high" | "med" | "low", category: rp.category, isIncluded: rp.isIncluded, isCritical: rp.isCritical,
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
