// Full production diagnostic - mirrors the EXACT dashboard API route
// No synthetic inputs. Uses real prisma, real tenant, real cache.
import prisma from '/Users/flans/CashFlowDecision OS copy/app/src/db/prisma.js';
import { computeForecast } from '/Users/flans/CashFlowDecision OS copy/app/src/services/forecast.js';
import { computeBaseline } from '/Users/flans/CashFlowDecision OS copy/app/src/services/baseline.js';
import { computeVarianceMultipliers } from '/Users/flans/CashFlowDecision OS copy/app/src/services/variance.js';
import { computeCOGSCorrelation } from '/Users/flans/CashFlowDecision OS copy/app/src/services/cogs-correlation.js';
import { computeTypicalDelayWeeks } from '/Users/flans/CashFlowDecision OS copy/app/src/services/payment-memory.js';
import { getMonday, addDays, parsePaymentCurve, computeExpectedPaymentDate } from '/Users/flans/CashFlowDecision OS copy/app/src/services/forecast.js';

(async () => {
  const cid = '1a7b36f5-8fe0-4c2b-9336-8420846270b5';
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

  // --- Log raw counts for auditing ---
  console.log('[DIAG] invoicesRaw:', invoicesRaw.length, 'billsRaw:', billsRaw.length);
  console.log('[DIAG] recurringPatternsRaw:', recurringPatternsRaw.length);
  console.log('[DIAG] overrides:', overrides.length);
  console.log('[DIAG] cashAdjustments:', cashAdjustments.length);
  console.log('[DIAG] cashSnapshot asOfDate:', cashSnapshot?.asOfDate);
  console.log('[DIAG] cashSnapshot bankBalance:', cashSnapshot?.bankBalance);

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

  console.log('[DIAG] payrollAllInAmount:', assumptions.payrollAllInAmount);
  console.log('[DIAG] payrollNextDate:', assumptions.payrollNextDate);
  console.log('[DIAG] rentMonthlyAmount:', assumptions.rentMonthlyAmount);
  console.log('[DIAG] rentDayOfMonth:', assumptions.rentDayOfMonth);

  const cachedBaseline = await prisma.baselineSnapshot.findUnique({
    where: { companyId: cid }
  });

  const now = Date.now();
  const isCacheValid = cachedBaseline && (now - cachedBaseline.updatedAt.getTime() < CACHE_TTL_MS);

  console.log('[DIAG] cache valid:', isCacheValid);
  console.log('[DIAG] variableInflowWeekly from cache:', cachedBaseline?.variableInflowWeekly);
  console.log('[DIAG] variableOutflowWeekly from cache:', cachedBaseline?.variableOutflowWeekly);

  let baseline: any;
  if (isCacheValid) {
    baseline = {
      variableInflowWeekly: cachedBaseline.variableInflowWeekly,
      variableOutflowWeekly: cachedBaseline.variableOutflowWeekly,
      variableInflowBand: cachedBaseline.variableInflowBand,
      variableOutflowBand: cachedBaseline.variableOutflowBand,
      conservativeInflowWeekly: cachedBaseline.conservativeInflowWeekly,
      conservativeOutflowWeekly: cachedBaseline.conservativeOutflowWeekly,
      weeklyBuckets: JSON.parse(cachedBaseline.weeklyBucketsJson),
      hasSufficientHistory: cachedBaseline.hasSufficientHistory,
      baselineConfidenceTier: cachedBaseline.baselineConfidenceTier,
      inflowCadence: parseInt(cachedBaseline.inflowCadence || "1", 10),
      outflowCadence: parseInt(cachedBaseline.outflowCadence || "1", 10),
      weeksAnalyzed: 0,
      computedFrom: "bank_tx",
      note: "Loaded from cache",
      methodNote: "Cached",
    };
  } else {
    const bankTxsForBaseline = bankTxs.map(tx => ({
      amount: tx.amount,
      date: tx.txDate,
      merchantKey: tx.description ?? "",
    }));
    const patternsForBaseline = recurringPatternsRaw.map(rp => ({
      merchantKey: rp.merchantKey ?? rp.displayName,
      direction: rp.direction,
      category: rp.category,
      isIncluded: rp.isIncluded,
      typicalAmount: rp.typicalAmount,
      amountStdDev: rp.amountStdDev,
      cadence: rp.cadence,
    }));
    baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, cashSnapshot.asOfDate, {
      payrollAllInAmount: assumptions.payrollAllInAmount,
      payrollNextDate: assumptions.payrollNextDate,
      payrollCadence: assumptions.payrollCadence,
      rentMonthlyAmount: assumptions.rentMonthlyAmount,
      rentDayOfMonth: assumptions.rentDayOfMonth,
    });
  }

  console.log('[DIAG] hasSufficientHistory:', baseline.hasSufficientHistory);

  const multipliers = computeVarianceMultipliers(varianceLedger);
  const varianceMultiplier = multipliers.outflow;
  const varianceMultiplierIn = multipliers.inflow;

  console.log('[DIAG] varianceMultiplier outflow:', varianceMultiplier);
  console.log('[DIAG] varianceMultiplier inflow:', varianceMultiplierIn);

  const cogsCorrelation = computeCOGSCorrelation(baseline.weeklyBuckets);

  // --- Build customer/vendor maps ---
  const customerMap = new Map(customerProfiles.map(c => [c.customerName, c]));
  const vendorMap = new Map(vendorProfiles.map(v => [v.vendorName, v]));
  const obsByCustomer = new Map<string, Array<{ daysEarlyOrLate: number }>>();
  for (const obs of customerPaymentObs) {
    if (!obsByCustomer.has(obs.customerName)) obsByCustomer.set(obs.customerName, []);
    obsByCustomer.get(obs.customerName)!.push(obs);
  }

  // --- Apply overrides ---
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
    let markedPaid = false, overrideExpectedDate: Date | null = null, overrideAmount: number | null = null, partialPayment: number | null = null, isExcluded = false;
    for (const ov of ovs) {
      if (ov.type === "mark_paid") markedPaid = true;
      if (ov.type === "exclude") isExcluded = true;
      if (ov.type === "set_expected_payment_date" && ov.effectiveDate) overrideExpectedDate = ov.effectiveDate;
      if (ov.type === "adjust_amount" && ov.amount != null) overrideAmount = ov.amount;
      if (ov.type === "partial_payment" && ov.amount != null) partialPayment = ov.amount;
    }
    if (isExcluded) return null;
    return { ...inv, typicalDelayWeeks: cp?.typicalDelayWeeks ?? computeTypicalDelayWeeks(obsByCustomer.get(inv.customerName) || []), riskTag: cp?.riskTag, overrideExpectedDate, overrideAmount, markedPaid, partialPayment };
  }).filter(Boolean);

  const bills = billsRaw.map(bill => {
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
    return { ...bill, criticality: vp?.criticality, overrideDueDate, overrideAmount, markedPaid };
  }).filter(Boolean);

  const skipDatesByPattern = new Map<string, string[]>();
  for (const ov of overrides) {
    if ((ov.type === "skip_recurring_occurrence" || ov.type === "modify_recurring_occurrence") && ov.targetId && ov.effectiveDate) {
      if (!skipDatesByPattern.has(ov.targetId)) skipDatesByPattern.set(ov.targetId, []);
      skipDatesByPattern.get(ov.targetId)!.push(ov.effectiveDate.toISOString().slice(0, 10));
    }
  }

  const recurring = recurringPatternsRaw.map(rp => ({
    ...rp,
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
      } else if (ov.metaJson) {
        try { const parsed = JSON.parse(ov.metaJson); if (parsed.displayName) displayName = parsed.displayName; } catch {}
      }
      return { patternId: ov.targetId!, displayName, amount: ov.amount!, weekStart: ov.effectiveDate!, sourceWeekStart };
    });

  console.log('[DIAG] oneTimeOutflows:', oneTimeOutflows.length);
  
  const bankBalance = cashSnapshot.bankBalance;
  const pastAdjustments = cashAdjustments.filter(a => a.origin === "system");
  const futureAdjustments = cashAdjustments.filter(a => a.origin === "user");
  const adjustmentsTotal = pastAdjustments.reduce((sum, a) => sum + a.amount, 0);
  const adjustedOpeningCash = bankBalance + adjustmentsTotal;

  console.log('[DIAG] bankBalance:', bankBalance);
  console.log('[DIAG] pastAdjustments total:', adjustmentsTotal);
  console.log('[DIAG] adjustedOpeningCash:', adjustedOpeningCash);
  console.log('[DIAG] futureAdjustments (user):', futureAdjustments.length);

  const totalOpenAR = invoicesRaw.reduce((s, i) => s + i.amountOpen, 0);
  const isARHeavy = totalOpenAR > (baseline.variableInflowWeekly || 0);

  const forecastInput = {
    adjustedOpeningCash,
    bankBalance,
    adjustmentsTotal,
    asOfDate: cashSnapshot.asOfDate,
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
    variableOutflowWeekly: baseline.variableOutflowWeekly * 1.0,
    variableOutflowBand: baseline.variableOutflowBand,
    baselineInflowWeekly: baseline.variableInflowWeekly * 1.0,
    baselineInflowBand: baseline.variableInflowBand,
    baselineInflowCadence: baseline.inflowCadence,
    baselineOutflowCadence: baseline.outflowCadence,
    cashMarginRatio: cogsCorrelation.cashMarginRatio,
    cogsLagWeeks: cogsCorrelation.cogsLagWeeks,
    isARHeavy,
    oneTimeOutflows,
    aiReasoningLog: cachedBaseline?.aiReasoningLogJson ?? undefined,
    aiInflowFactors: cachedBaseline?.aiInflowFactorsJson ? JSON.parse(cachedBaseline.aiInflowFactorsJson) : undefined,
    aiOutflowFactors: cachedBaseline?.aiOutflowFactorsJson ? JSON.parse(cachedBaseline.aiOutflowFactorsJson) : undefined,
    aiInflowExplanations: cachedBaseline?.aiInflowExplanationsJson ? JSON.parse(cachedBaseline.aiInflowExplanationsJson) : undefined,
    aiOutflowExplanations: cachedBaseline?.aiOutflowExplanationsJson ? JSON.parse(cachedBaseline.aiOutflowExplanationsJson) : undefined,
    cashFlowEntries: [
      ...futureAdjustments.map((a: any) => ({
        categoryId: "custom",
        categoryName: a.type,
        direction: a.amount >= 0 ? ("inflow" as const) : ("outflow" as const),
        label: a.note || a.type,
        amount: Math.abs(a.amount),
        targetDate: a.effectiveDate,
        sourceId: a.id,
      }))
    ],
  };

  console.log('[DIAG] forecastInput.variableOutflowWeekly (after mult):', forecastInput.variableOutflowWeekly);
  console.log('[DIAG] forecastInput.baselineInflowWeekly (after mult):', forecastInput.baselineInflowWeekly);
  console.log('[DIAG] forecastInput.cashMarginRatio:', forecastInput.cashMarginRatio);
  console.log('[DIAG] forecastInput.cogsLagWeeks:', forecastInput.cogsLagWeeks);
  console.log('[DIAG] forecastInput.aiInflowFactors:', forecastInput.aiInflowFactors);
  console.log('[DIAG] forecastInput.aiOutflowFactors:', forecastInput.aiOutflowFactors);

  const forecast = computeForecast(forecastInput);
  const w0 = forecast.weeks[0];

  console.log('\n=== WEEK 1 RESULT ===');
  console.log('inflowsExpected:', w0.inflowsExpected);
  console.log('outflowsExpected:', w0.outflowsExpected);
  console.log('startCash:', w0.startCash);
  console.log('endCashExpected:', w0.endCashExpected);
  console.log('zone:', w0.zone);

  console.log('\n=== INFLOW BREAKDOWN ===');
  let inflowSum = 0;
  for (const item of w0.breakdown.inflows) {
    console.log(`  [${item.sourceType}] ${item.label}: ${item.amount}`);
    inflowSum += item.amount;
  }
  console.log('Inflow sum from breakdown:', inflowSum);
  console.log('Inflow expected reported:', w0.inflowsExpected);

  console.log('\n=== OUTFLOW BREAKDOWN ===');
  let outflowSum = 0;
  for (const item of w0.breakdown.outflows) {
    console.log(`  [${item.sourceType}] ${item.label}: ${item.amount}`);
    outflowSum += item.amount;
  }
  console.log('Outflow sum from breakdown:', outflowSum);
  console.log('Outflow expected reported:', w0.outflowsExpected);

  console.log('\n=== 13 WEEK FORECAST ===');
  forecast.weeks.forEach((w, i) => {
    const weekStartStr = addDays(forecastInput.asOfDate, i * 7).toISOString().slice(0, 10);
    console.log(`Week ${i+1} (${weekStartStr}): Start: ${w.startCash.toFixed(2)} | In: ${w.inflowsExpected.toFixed(2)} | Out: ${w.outflowsExpected.toFixed(2)} | End: ${w.endCashExpected.toFixed(2)} | Best: ${w.bestCaseEnd?.toFixed(2) ?? 'N/A'} | Worst: ${w.worstCaseEnd?.toFixed(2) ?? 'N/A'}`);
  });

  process.exit(0);
})();
