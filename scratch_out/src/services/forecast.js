"use strict";
// services/forecast.ts – 13-week cash flow forecast engine
// Pure deterministic logic. No React, no DB imports.
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMonday = getMonday;
exports.addWeeks = addWeeks;
exports.addDays = addDays;
exports.isInWeek = isInWeek;
exports.parsePaymentCurve = parsePaymentCurve;
exports.computeExpectedPaymentDate = computeExpectedPaymentDate;
exports.computeForecast = computeForecast;
const types_1 = require("@/domain/types");
// ─── Helpers ────────────────────────────────────────────────────────────
function getMonday(d) {
    const dt = new Date(d);
    // If it's a UTC midnight date (e.g. from Prisma), we use its UTC calendar day.
    if (dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0) {
        const day = dt.getUTCDay();
        const diff = (day === 0 ? -6 : 1 - day);
        return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + diff));
    }
    // Otherwise, use the user's local timezone calendar day.
    const day = dt.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate() + diff));
}
function addWeeks(d, n) {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n * 7);
    return dt;
}
function addDays(d, n) {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
}
function daysBetween(a, b) {
    return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}
/** Normalize a Date to midnight UTC on its calendar date, eliminating
 *  time-of-day effects when comparing against week boundaries.
 *  This prevents timezone offsets from shifting an item into the wrong week
 *  (e.g. a recurring item stored as "Mar 22 23:00 UTC" but logically due on
 *  Mar 22 local should still land in the week that contains Mar 22). */
function toDateOnly(d) {
    const dt = new Date(d);
    if (dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0) {
        return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    }
    return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
}
function isInWeek(date, weekStart, weekEnd) {
    const d = toDateOnly(date);
    const ws = toDateOnly(weekStart);
    const we = toDateOnly(weekEnd);
    return d >= ws && d <= we;
}
function parsePaymentCurve(json) {
    try {
        return JSON.parse(json);
    }
    catch {
        return types_1.DEFAULT_PAYMENT_CURVE;
    }
}
function hashForecast(weeks) {
    const data = weeks.map(w => {
        const iso = isNaN(w.weekStart.getTime()) ? "INVALID" : w.weekStart.toISOString();
        return `${iso}|${w.endCashExpected}|${w.endCashWorst}|${w.endCashBest}`;
    }).join(";");
    // Simple hash
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
        const char = data.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}
// ─── Expected Payment Date Logic ────────────────────────────────────────
function computeExpectedPaymentDate(invoice, today, paymentCurve) {
    // Override takes priority
    if (invoice.overrideExpectedDate) {
        return { date: invoice.overrideExpectedDate, confidence: "high", missingDate: false };
    }
    // Step 1: Determine baseDueDate
    let baseDueDate;
    let missingDate = false;
    if (invoice.dueDate) {
        baseDueDate = new Date(invoice.dueDate);
    }
    else if (invoice.invoiceDate) {
        baseDueDate = addDays(new Date(invoice.invoiceDate), 30);
    }
    else if (invoice.daysPastDue != null) {
        baseDueDate = addDays(today, -invoice.daysPastDue);
    }
    else {
        // Missing date anomaly: assume today + 30 days as standard Net 30 fallback
        baseDueDate = addDays(today, 30);
        missingDate = true;
    }
    // Step 2: Compute aging days
    const agingDays = daysBetween(baseDueDate, today);
    // Step 3: Determine payment curve shift (weeks)
    let shiftWeeks;
    if (invoice.typicalDelayWeeks != null) {
        // Customer profile overrides global curve
        shiftWeeks = invoice.typicalDelayWeeks;
    }
    else if (agingDays <= 0) {
        shiftWeeks = paymentCurve.current;
    }
    else if (agingDays <= 14) {
        shiftWeeks = paymentCurve["1-14"];
    }
    else if (agingDays <= 30) {
        shiftWeeks = paymentCurve["15-30"];
    }
    else if (agingDays <= 60) {
        shiftWeeks = paymentCurve["31-60"];
    }
    else {
        shiftWeeks = paymentCurve["61+"];
    }
    const expectedDate = addDays(baseDueDate, shiftWeeks * 7);
    // Step 4: Determine confidence
    let confidence = "high";
    if (missingDate) {
        confidence = "low";
    }
    else if (agingDays > 60) {
        confidence = "low";
    }
    else if (agingDays > 14) {
        confidence = "med";
    }
    // High risk tag lowers confidence
    if (invoice.riskTag === "high") {
        confidence = "low";
    }
    return { date: expectedDate, confidence, missingDate };
}
// ─── Main Forecast Computation ──────────────────────────────────────────
function computeForecast(input) {
    const today = input.asOfDate;
    const paymentCurve = parsePaymentCurve(input.assumptions.paymentCurveJson);
    const buffer = input.assumptions.bufferMin;
    // Build 13 weeks starting from Monday of current week
    const currentMonday = getMonday(today);
    const weeks = [];
    // Pre-allocate maps for all 13 weeks
    const invoicesByWeek = new Map();
    const billsByWeek = new Map();
    const recurringByWeek = new Map();
    const recurringInflowsByWeek = new Map();
    for (let w = 0; w < 13; w++) {
        invoicesByWeek.set(w, []);
        billsByWeek.set(w, []);
        recurringInflowsByWeek.set(w, []);
        recurringByWeek.set(w, []);
    }
    // ─── Allocate manual cash flow entries to weeks ────────────────────
    const manualEntriesByWeek = new Map();
    for (let w = 0; w < 13; w++)
        manualEntriesByWeek.set(w, []);
    for (const entry of (input.cashFlowEntries || [])) {
        for (let w = 0; w < 13; w++) {
            const weekStart = addWeeks(currentMonday, w);
            const weekEnd = addDays(weekStart, 6);
            const d = new Date(entry.targetDate);
            if (isInWeek(d, weekStart, weekEnd) || (w === 0 && d < weekStart)) {
                manualEntriesByWeek.get(w).push(entry);
                break;
            }
        }
    }
    // ─── Allocate invoices to weeks ────────────────────────────────────
    for (const inv of input.invoices) {
        if (inv.status !== "open")
            continue;
        if (inv.markedPaid)
            continue;
        let amount = inv.amountOpen;
        if (inv.overrideAmount != null)
            amount = inv.overrideAmount;
        if (inv.partialPayment != null)
            amount = Math.max(0, amount - inv.partialPayment);
        if (amount <= 0)
            continue;
        const { date: expectedDate, confidence } = computeExpectedPaymentDate(inv, today, paymentCurve);
        for (let w = 0; w < 13; w++) {
            const weekStart = addWeeks(currentMonday, w);
            const weekEnd = addDays(weekStart, 6);
            if (isInWeek(expectedDate, weekStart, weekEnd) || (w === 0 && expectedDate < weekStart)) {
                invoicesByWeek.get(w).push({
                    invoice: inv,
                    amount,
                    confidence,
                    committed: confidence === "high",
                });
                break;
            }
        }
        // If beyond 13 weeks, it doesn't factor in
    }
    // ─── Allocate bills to weeks ───────────────────────────────────────
    for (const bill of input.bills) {
        if (bill.status !== "open")
            continue;
        if (bill.markedPaid)
            continue;
        let amount = bill.amountOpen;
        if (bill.overrideAmount != null)
            amount = bill.overrideAmount;
        if (amount <= 0)
            continue;
        let billDueDate;
        if (bill.overrideDueDate) {
            billDueDate = new Date(bill.overrideDueDate);
        }
        else if (bill.dueDate) {
            billDueDate = new Date(bill.dueDate);
        }
        else if (bill.billDate) {
            billDueDate = addDays(new Date(bill.billDate), 30);
        }
        else {
            billDueDate = addDays(today, 7); // fallback
        }
        for (let w = 0; w < 13; w++) {
            const weekStart = addWeeks(currentMonday, w);
            const weekEnd = addDays(weekStart, 6);
            if (isInWeek(billDueDate, weekStart, weekEnd) || (w === 0 && billDueDate < weekStart)) {
                billsByWeek.get(w).push({ bill, amount });
                break;
            }
        }
    }
    // ─── Allocate recurring outflows to weeks ──────────────────────────
    for (const rec of input.recurring) {
        if (!rec.isIncluded)
            continue;
        if (rec.status === "ignored")
            continue;
        if (rec.direction !== "outflow")
            continue;
        let nextDate = rec.nextExpectedDate ? new Date(rec.nextExpectedDate) : null;
        if (!nextDate)
            continue;
        // Build a normalised set of skipped week-start dates (YYYY-MM-DD)
        const skipSet = new Set((rec.skipDates ?? []).map(s => s.slice(0, 10)));
        // Schedule occurrences for 13 weeks
        let d = new Date(nextDate);
        const endDate = addWeeks(currentMonday, 13);
        const windowStart = new Date(currentMonday);
        // Advance past-due occurrences to current window to prevent historical stacking in W0
        while (d < currentMonday) {
            let nextD;
            if (rec.cadence === "weekly")
                nextD = addDays(d, 7);
            else if (rec.cadence === "biweekly")
                nextD = addDays(d, 14);
            else if (rec.cadence === "monthly") {
                nextD = new Date(d);
                nextD.setMonth(nextD.getMonth() + 1);
            }
            else
                break;
            d = nextD;
        }
        while (d <= endDate) {
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    // Skip this occurrence if it has been rescheduled away
                    const weekStartISO = isNaN(weekStart.getTime()) ? "0000-00-00" : weekStart.toISOString().slice(0, 10);
                    if (!skipSet.has(weekStartISO)) {
                        recurringByWeek.get(w).push({ pattern: rec, amount: rec.typicalAmount });
                    }
                    break;
                }
            }
            // Advance to next occurrence
            if (rec.cadence === "weekly")
                d = addDays(d, 7);
            else if (rec.cadence === "biweekly")
                d = addDays(d, 14);
            else if (rec.cadence === "monthly") {
                const next = new Date(d);
                next.setMonth(next.getMonth() + 1);
                d = next;
            }
            else
                break; // irregular: only one occurrence
        }
    }
    // ─── Inject one-time outflows from rescheduled recurring items ─────────
    for (const oto of (input.oneTimeOutflows ?? [])) {
        for (let w = 0; w < 13; w++) {
            const weekStart = addWeeks(currentMonday, w);
            const weekEnd = addDays(weekStart, 6);
            if (isInWeek(oto.weekStart, weekStart, weekEnd)) {
                const originalPattern = input.recurring.find((r) => r.id === oto.patternId);
                const syntheticPattern = {
                    ...originalPattern,
                    id: `resched-${oto.patternId}-${w}`,
                    direction: "outflow",
                    status: "active",
                    origin: "system",
                    displayName: `${oto.displayName} (Rescheduled)`,
                    typicalAmount: oto.amount,
                    amountStdDev: 0,
                    cadence: "irregular",
                    nextExpectedDate: oto.weekStart,
                    confidence: originalPattern?.confidence ?? "high",
                    category: originalPattern?.category ?? "other",
                    isIncluded: true,
                    isCritical: originalPattern?.isCritical ?? false,
                };
                recurringByWeek.get(w).push({
                    pattern: syntheticPattern,
                    amount: oto.amount,
                    rescheduled: true,
                    meta: { sourceWeekStart: oto.sourceWeekStart }
                });
                break;
            }
        }
    }
    // ─── Add Payroll Assumption to recurring outflows ──────────────────
    if (input.assumptions.payrollAllInAmount && input.assumptions.payrollNextDate) {
        let d = new Date(input.assumptions.payrollNextDate);
        const amount = input.assumptions.payrollAllInAmount;
        const cadence = input.assumptions.payrollCadence || "biweekly";
        const endDate = addWeeks(currentMonday, 13);
        const windowStart = new Date(currentMonday);
        const payrollPattern = {
            id: "synthetic-payroll",
            direction: "outflow",
            displayName: "Payroll (Assumed)",
            typicalAmount: amount,
            amountStdDev: 0,
            cadence: cadence,
            nextExpectedDate: input.assumptions.payrollNextDate,
            confidence: "high",
            category: "payroll",
            isIncluded: true,
            isCritical: true,
            status: "active",
            origin: "system"
        };
        while (d <= endDate) {
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    recurringByWeek.get(w).push({ pattern: payrollPattern, amount });
                    break;
                }
            }
            if (cadence === "weekly")
                d = addDays(d, 7);
            else if (cadence === "biweekly")
                d = addDays(d, 14);
            else if (cadence === "monthly") {
                const next = new Date(d);
                next.setMonth(next.getMonth() + 1);
                d = next;
            }
            else
                break;
        }
    }
    // ─── Add Rent Assumption to recurring outflows ─────────────────────
    if (input.assumptions.rentMonthlyAmount && input.assumptions.rentDayOfMonth) {
        const amount = input.assumptions.rentMonthlyAmount;
        const day = input.assumptions.rentDayOfMonth;
        const endDate = addWeeks(currentMonday, 13);
        const rentPattern = {
            id: "synthetic-rent",
            direction: "outflow",
            displayName: "Rent (Assumed)",
            typicalAmount: amount,
            amountStdDev: 0,
            cadence: "monthly",
            nextExpectedDate: null, // computed per month
            confidence: "high",
            category: "rent",
            isIncluded: true,
            isCritical: true,
            status: "active",
            origin: "system"
        };
        let d = new Date(currentMonday);
        d.setDate(day);
        // If the day already passed this month, start next month
        if (d < currentMonday)
            d.setMonth(d.getMonth() + 1);
        while (d <= endDate) {
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    recurringByWeek.get(w).push({ pattern: rentPattern, amount });
                    break;
                }
            }
            const next = new Date(d);
            next.setMonth(next.getMonth() + 1);
            d = next;
        }
    }
    // ─── Allocate recurring inflows to weeks ───────────────────────────
    for (const rec of input.recurring) {
        if (!rec.isIncluded)
            continue;
        if (rec.status === "ignored")
            continue;
        if (rec.direction !== "inflow")
            continue;
        let nextDate = rec.nextExpectedDate ? new Date(rec.nextExpectedDate) : null;
        if (!nextDate)
            continue;
        let d = new Date(nextDate);
        const endDate = addWeeks(currentMonday, 13);
        const windowStart = new Date(currentMonday);
        // Advance past-due occurrences to current window to prevent historical stacking in W0
        while (d < currentMonday) {
            let nextD;
            if (rec.cadence === "weekly")
                nextD = addDays(d, 7);
            else if (rec.cadence === "biweekly")
                nextD = addDays(d, 14);
            else if (rec.cadence === "monthly") {
                nextD = new Date(d);
                nextD.setMonth(nextD.getMonth() + 1);
            }
            else
                break;
            d = nextD;
        }
        while (d <= endDate) {
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    recurringInflowsByWeek.get(w).push({ pattern: rec, amount: rec.typicalAmount });
                    break;
                }
            }
            if (rec.cadence === "weekly")
                d = addDays(d, 7);
            else if (rec.cadence === "biweekly")
                d = addDays(d, 14);
            else if (rec.cadence === "monthly") {
                const next = new Date(d);
                next.setMonth(next.getMonth() + 1);
                d = next;
            }
            else
                break;
        }
    }
    // ─── Build weeks ──────────────────────────────────────────────────
    let runningCashExpected = input.adjustedOpeningCash;
    let runningCashBest = input.adjustedOpeningCash;
    let runningCashWorst = input.adjustedOpeningCash;
    let lowestExpected = runningCashExpected;
    let lowestWorst = runningCashWorst;
    let constraintWeek = null;
    let worstConstraintWeek = null;
    let expectedRunOut = null;
    let worstRunOut = null;
    const pendingCogs = new Array(13).fill(0);
    for (let w = 0; w < 13; w++) {
        const weekStart = addWeeks(currentMonday, w);
        const weekEnd = addDays(weekStart, 6);
        const weekInvoices = invoicesByWeek.get(w) || [];
        const weekBills = billsByWeek.get(w) || [];
        const weekRecurring = recurringByWeek.get(w) || [];
        const weekRecurringInflows = recurringInflowsByWeek.get(w) || [];
        const weekManualEntries = manualEntriesByWeek.get(w) || [];
        // ── Determine zone ──────────────────────────────────────────
        // RULE: committed items always produce "committed" zone regardless
        // of week number or bank baseline availability.
        const hasCommittedInvoices = weekInvoices.some(i => i.committed);
        const hasCommittedBills = weekBills.length > 0;
        // High-confidence recurring (payroll, rent, loan) are committed anchors
        const hasCommittedRecurring = weekRecurring.some(r => r.pattern.confidence === "high");
        const hasCommittedData = hasCommittedInvoices || hasCommittedBills || hasCommittedRecurring;
        let zone;
        if (hasCommittedData) {
            zone = "committed";
        }
        else if (input.hasBankBaseline) {
            zone = w <= 6 ? "pattern" : "uncertain";
        }
        else {
            zone = "uncertain";
        }
        // ── Inflows ─────────────────────────────────────────────────
        const inflowBreakdown = [];
        let inflowExpected = 0;
        let inflowBest = 0;
        let inflowWorst = 0;
        for (const item of weekInvoices) {
            inflowExpected += item.amount;
            inflowBest += item.amount * (item.confidence === "high" ? 1.0 : item.confidence === "med" ? 1.1 : 1.2);
            inflowWorst += item.amount * (item.confidence === "high" ? 1.0 : item.confidence === "med" ? 0.5 : 0.2);
            inflowBreakdown.push({
                label: `${item.invoice.customerName} (${item.invoice.invoiceNo})`,
                amount: item.amount,
                type: item.invoice.overrideExpectedDate ? "overridden" : (item.committed ? "committed" : "assumed"),
                sourceType: "invoice",
                sourceId: item.invoice.id,
                confidence: item.confidence,
                section: "AR Receipts",
                metadata: {
                    sourceAmountAtForecast: item.invoice.amountOpen,
                    sourceDateAtForecast: item.invoice.dueDate,
                    sourceStatusAtForecast: item.invoice.status,
                    overrideId: null // We'll add this if we have it in the future
                }
            });
        }
        // Recurring inflows
        for (const item of weekRecurringInflows) {
            inflowExpected += item.amount;
            inflowBest += item.amount * 1.1;
            inflowWorst += item.amount * 0.7;
            inflowBreakdown.push({
                label: item.pattern.displayName,
                amount: item.amount,
                type: item.rescheduled ? "rescheduled" : (item.pattern.confidence === "high" ? "committed" : "assumed"),
                sourceType: "recurring",
                sourceId: item.pattern.id,
                confidence: item.pattern.confidence,
                section: "Recurring Inflows",
                metadata: {
                    ...(item.meta || {}),
                    sourceAmountAtForecast: item.pattern.typicalAmount,
                    sourceDateAtForecast: item.pattern.nextExpectedDate,
                }
            });
        }
        // Manual custom inflows (from Cash Adjustments)
        for (const entry of weekManualEntries) {
            if (entry.direction !== "inflow")
                continue;
            inflowExpected += entry.amount;
            inflowBest += entry.amount;
            inflowWorst += entry.amount;
            inflowBreakdown.push({
                label: entry.label || entry.categoryName,
                amount: entry.amount,
                type: "committed",
                sourceType: "manual",
                sourceId: entry.sourceId,
                confidence: "high",
                section: `Cat: ${entry.categoryName}`,
            });
        }
        // ── Baseline Gap-Filling Fade logic ──
        let revenueFade = 1.0;
        let spendFade = 1.0;
        // We used to aggressively fade *uncertain future revenue* downwards over time,
        // and hold *variable spend* flat (or inflate it).
        // However, since we are projecting statistical means, fading a mean over time is mathematically incorrect
        // and causes the projection to artificially drift. So we now keep them flat at 1.0.
        const safetyMargin = input.assumptions.projectionSafetyMargin ?? 1.0;
        const inflowMultiplier = revenueFade * safetyMargin;
        // Inverse for outflows: when margin is low (conservative), outflow should be high.
        // We use (2 - safetyMargin) to keep the 0.5-1.5 range symmetric around 1.0.
        const outflowMultiplier = spendFade * (2 - safetyMargin);
        // ── Stage 1 & 2: Pipeline-Aware AI Baseline (Inflow) ──
        const scheduledInflowSum = inflowBreakdown
            .filter(i => i.sourceType === "invoice" || i.sourceType === "recurring")
            .reduce((s, i) => s + i.amount, 0);
        let inflowGap = 0;
        let projConfidence = "low";
        let projLabel = "";
        if (input.hasBankBaseline && input.baselineInflowWeekly > 0) {
            // How much of the historical baseline is already represented in the pipeline this week?
            const pipelineCoverage = Math.min(1.0, scheduledInflowSum / input.baselineInflowWeekly);
            // The remaining un-invoiced gap
            let baselineInflowWeekly = input.baselineInflowWeekly * inflowMultiplier * (1 - pipelineCoverage);
            // For metadata tracking:
            const stage1Raw = input.baselineInflowWeekly * inflowMultiplier;
            const explicitDeduction = stage1Raw * pipelineCoverage;
            const stage2PreAi = baselineInflowWeekly;
            // Stage 2: AI Accuracy Override
            const aiFactor = input.aiInflowFactors?.[w] ?? 1.0;
            baselineInflowWeekly = baselineInflowWeekly * aiFactor;
            if (baselineInflowWeekly > 0) {
                inflowGap = baselineInflowWeekly;
                inflowExpected += inflowGap;
                inflowBest += inflowGap * (1 + (input.baselineInflowBand || 0.1));
                inflowWorst += inflowGap * (1 - (input.baselineInflowBand || 0.15));
                const tier = input.baselineConfidenceTier ?? "none";
                projConfidence = tier === "high" ? "med" : "low";
                // Stage 3: AI Articulation
                if (input.aiInflowExplanations && input.aiInflowExplanations[w] && !input.aiInflowExplanations[w].startsWith("AI Error:")) {
                    projLabel = input.aiInflowExplanations[w];
                }
                else {
                    const coveragePct = Math.round(pipelineCoverage * 100);
                    const tierStr = tier === "high" ? "historical baseline" :
                        tier === "med" ? "moderate history" :
                            "limited history";
                    projLabel = `Projected inflow (${tierStr}) — AR covers ${coveragePct}% of baseline`;
                }
                inflowBreakdown.push({
                    label: projLabel,
                    amount: inflowGap,
                    type: "assumed",
                    sourceType: "baseline",
                    confidence: projConfidence,
                    section: "Baseline Inflow",
                    metadata: {
                        stage1Raw: stage1Raw,
                        explicitDeduction: explicitDeduction,
                        stage2PreAi: stage2PreAi,
                        aiFactor: aiFactor
                    }
                });
            }
        }
        // flag for variable outflow logic later
        const addedAnyInflowBaseline = (input.hasBankBaseline && inflowGap > 0);
        // COGS-linked outflow projection
        const cashMarginRatio = input.cashMarginRatio ?? 1.0;
        const cogsLagWeeks = input.cogsLagWeeks ?? 0;
        const cogsProjected = inflowExpected * (1 - cashMarginRatio);
        if (w + cogsLagWeeks < 13) {
            pendingCogs[w + cogsLagWeeks] += cogsProjected;
        }
        // ── Outflows ────────────────────────────────────────────────
        const outflowBreakdown = [];
        let outflowExpected = 0;
        let outflowBest = 0;
        let outflowWorst = 0;
        // Bills
        for (const item of weekBills) {
            outflowExpected += item.amount;
            outflowBest += item.amount;
            outflowWorst += item.amount;
            outflowBreakdown.push({
                label: `${item.bill.vendorName} (${item.bill.billNo})`,
                amount: item.amount,
                type: item.bill.overrideDueDate ? "overridden" : "committed",
                sourceType: "bill",
                sourceId: item.bill.id,
                confidence: "high",
                section: "AP Bills",
                metadata: {
                    sourceAmountAtForecast: item.bill.amountOpen,
                    sourceDateAtForecast: item.bill.dueDate,
                    sourceStatusAtForecast: item.bill.status,
                    expenseClass: item.bill.expenseClass,
                }
            });
        }
        // Recurring outflows
        for (const item of weekRecurring) {
            const stdRatio = item.pattern.typicalAmount > 0
                ? item.pattern.amountStdDev / item.pattern.typicalAmount
                : 0;
            outflowExpected += item.amount;
            outflowBest += item.amount * (1 - stdRatio * 0.5);
            outflowWorst += item.amount * (1 + stdRatio * 0.5);
            outflowBreakdown.push({
                label: item.pattern.displayName,
                amount: item.amount,
                type: item.rescheduled ? "rescheduled" : (item.pattern.confidence === "high" ? "committed" : "assumed"),
                sourceType: "recurring",
                sourceId: item.pattern.id,
                confidence: item.pattern.confidence,
                section: "Recurring Commitments",
                metadata: {
                    ...(item.meta || {}),
                    sourceAmountAtForecast: item.pattern.typicalAmount,
                    sourceDateAtForecast: item.pattern.nextExpectedDate,
                }
            });
        }
        // Manual custom outflows (from Cash Adjustments)
        for (const entry of weekManualEntries) {
            if (entry.direction !== "outflow")
                continue;
            outflowExpected += entry.amount;
            outflowBest += entry.amount;
            outflowWorst += entry.amount;
            outflowBreakdown.push({
                label: entry.label || entry.categoryName,
                amount: entry.amount,
                type: "committed",
                sourceType: "manual",
                sourceId: entry.sourceId,
                confidence: "high",
                section: `Cat: ${entry.categoryName}`,
            });
        }
        // Fixed weekly outflow
        if (input.assumptions.fixedWeeklyOutflow > 0) {
            const fixed = input.assumptions.fixedWeeklyOutflow;
            outflowExpected += fixed;
            outflowBest += fixed;
            outflowWorst += fixed;
            outflowBreakdown.push({
                label: "Fixed weekly outflow (assumption)",
                amount: fixed,
                type: "assumed", // it's a user-defined assumption, not a verified bill
                sourceType: "assumption",
                confidence: "med",
                section: "Fixed Weekly Assumption",
            });
        }
        // ── Stage 1 & 2: Pipeline-Aware AI Baseline (Outflow) ──
        const scheduledVariableOutflowSum = outflowBreakdown
            .filter(i => {
            if (["payroll", "recurring", "assumption", "manual"].includes(i.sourceType))
                return false;
            return true;
        })
            .reduce((s, i) => s + i.amount, 0);
        let outflowGap = 0;
        let projOutConfidence = "low";
        let projOutLabel = "";
        if (input.hasBankBaseline && input.variableOutflowWeekly > 0) {
            // How much of the historical variable outflow baseline is already represented in AP Bills this week?
            const pipelineCoverageOut = Math.min(1.0, scheduledVariableOutflowSum / input.variableOutflowWeekly);
            // The remaining un-billed gap
            let baselineVarOutWeekly = input.variableOutflowWeekly * outflowMultiplier * (1 - pipelineCoverageOut);
            // For metadata tracking:
            const stage1RawOut = input.variableOutflowWeekly * outflowMultiplier;
            const explicitDeductionOut = stage1RawOut * pipelineCoverageOut;
            const stage2PreAiOut = baselineVarOutWeekly;
            // Stage 2: AI Accuracy Override
            const aiOutFactor = input.aiOutflowFactors?.[w] ?? 1.0;
            baselineVarOutWeekly = baselineVarOutWeekly * aiOutFactor;
            if (baselineVarOutWeekly > 0) {
                outflowGap = baselineVarOutWeekly;
                outflowExpected += outflowGap;
                outflowBest += outflowGap * (1 - (input.variableOutflowBand || 0.1));
                outflowWorst += outflowGap * (1 + (input.variableOutflowBand || 0.2));
                const tier = input.baselineConfidenceTier ?? "none";
                projOutConfidence = tier === "high" ? "med" : "low";
                if (input.aiOutflowExplanations && input.aiOutflowExplanations[w] && !input.aiOutflowExplanations[w].startsWith("AI Error:")) {
                    projOutLabel = input.aiOutflowExplanations[w];
                }
                else {
                    const coveragePct = Math.round(pipelineCoverageOut * 100);
                    const tierStr = tier === "high" ? "historical baseline" :
                        tier === "med" ? "moderate history" :
                            "limited history";
                    projOutLabel = `Projected variable spend (${tierStr}) — AP covers ${coveragePct}% of baseline`;
                }
                outflowBreakdown.push({
                    label: projOutLabel,
                    amount: outflowGap,
                    type: "assumed",
                    sourceType: "baseline",
                    confidence: projOutConfidence,
                    section: "Baseline Outflow",
                    metadata: {
                        stage1Raw: stage1RawOut,
                        explicitDeduction: explicitDeductionOut,
                        stage2PreAi: stage2PreAiOut,
                        aiFactor: aiOutFactor
                    }
                });
            }
        }
        // Push payroll to the top of the outflows list
        outflowBreakdown.sort((a, b) => {
            const aIsPayroll = a.label.toLowerCase().includes("payroll");
            const bIsPayroll = b.label.toLowerCase().includes("payroll");
            if (aIsPayroll && !bIsPayroll)
                return -1;
            if (!aIsPayroll && bIsPayroll)
                return 1;
            return 0;
        });
        // ── Compute end cash ────────────────────────────────────────
        const endCashExpected = runningCashExpected + inflowExpected - outflowExpected;
        const endCashBest = runningCashBest + inflowBest - outflowBest;
        const endCashWorst = runningCashWorst + inflowWorst - outflowWorst;
        // ── Confidence score per week ───────────────────────────────
        let weekConfidence = 100;
        if (zone === "pattern")
            weekConfidence -= 10;
        if (zone === "uncertain")
            weekConfidence -= 25;
        // Reduce for high-risk invoices in this week
        const highRiskPct = weekInvoices.filter(i => i.confidence === "low").length / Math.max(1, weekInvoices.length);
        if (highRiskPct > 0.25)
            weekConfidence -= 15;
        weekConfidence = Math.max(0, Math.min(100, weekConfidence));
        // ── Worst-case driver: find largest expected→worst gap contributor ──
        // For outflows: worst > expected = bad; For inflows: worst < expected = bad
        let worstCaseDriver = null;
        let largestDelta = 0;
        for (const item of outflowBreakdown) {
            // Outflow worst > expected means larger drain
            // We approximate per-item worst as item.amount * (1 + band) for assumed items
            const itemWorstDelta = item.type === "assumed" ? item.amount * 0.2 : 0;
            if (itemWorstDelta > largestDelta) {
                largestDelta = itemWorstDelta;
                worstCaseDriver = item.label;
            }
        }
        for (const item of inflowBreakdown) {
            // Inflow worst < expected means less cash
            const itemWorstDelta = item.confidence === "low"
                ? item.amount * 0.8 // low confidence: could get only 20%
                : item.confidence === "med"
                    ? item.amount * 0.5
                    : 0;
            if (itemWorstDelta > largestDelta) {
                largestDelta = itemWorstDelta;
                worstCaseDriver = item.label;
            }
        }
        weeks.push({
            weekNumber: w + 1,
            weekStart,
            weekEnd,
            startCash: runningCashExpected,
            inflowsExpected: Math.round(inflowExpected * 100) / 100,
            outflowsExpected: Math.round(outflowExpected * 100) / 100,
            endCashExpected: Math.round(endCashExpected * 100) / 100,
            inflowsBest: Math.round(inflowBest * 100) / 100,
            outflowsBest: Math.round(outflowBest * 100) / 100,
            endCashBest: Math.round(endCashBest * 100) / 100,
            inflowsWorst: Math.round(inflowWorst * 100) / 100,
            outflowsWorst: Math.round(outflowWorst * 100) / 100,
            endCashWorst: Math.round(endCashWorst * 100) / 100,
            zone,
            confidenceScore: weekConfidence,
            breakdown: { inflows: inflowBreakdown, outflows: outflowBreakdown },
            worstCaseDriver,
        });
        // Track metrics
        if (endCashExpected < lowestExpected)
            lowestExpected = endCashExpected;
        if (endCashWorst < lowestWorst)
            lowestWorst = endCashWorst;
        if (constraintWeek === null && endCashExpected < buffer) {
            constraintWeek = w + 1;
        }
        if (worstConstraintWeek === null && endCashWorst < buffer) {
            worstConstraintWeek = w + 1;
        }
        if (expectedRunOut === null && endCashExpected < 0) {
            expectedRunOut = w + 1;
        }
        if (worstRunOut === null && endCashWorst < 0) {
            worstRunOut = w + 1;
        }
        // Carry forward
        runningCashExpected = endCashExpected;
        runningCashBest = endCashBest;
        runningCashWorst = endCashWorst;
    }
    return {
        weeks,
        constraintWeek,
        worstCaseConstraintWeek: worstConstraintWeek,
        expectedRunOutWeek: expectedRunOut,
        worstCaseRunOutWeek: worstRunOut,
        lowestExpectedBalance: Math.round(lowestExpected * 100) / 100,
        lowestWorstBalance: Math.round(lowestWorst * 100) / 100,
        forecastVersionHash: hashForecast(weeks),
    };
}
