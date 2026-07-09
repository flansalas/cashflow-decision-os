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
var types_1 = require("@/domain/types");
// ─── Helpers ────────────────────────────────────────────────────────────
function getMonday(d) {
    var dt = new Date(d);
    // If it's a UTC midnight date (e.g. from Prisma), we use its UTC calendar day.
    if (dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0) {
        var day_1 = dt.getUTCDay();
        var diff_1 = (day_1 === 0 ? -6 : 1 - day_1);
        return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate() + diff_1));
    }
    // Otherwise, use the user's local timezone calendar day.
    var day = dt.getDay();
    var diff = (day === 0 ? -6 : 1 - day);
    return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate() + diff));
}
function addWeeks(d, n) {
    var dt = new Date(d);
    dt.setDate(dt.getDate() + n * 7);
    return dt;
}
function addDays(d, n) {
    var dt = new Date(d);
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
    var dt = new Date(d);
    if (dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0) {
        return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    }
    return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
}
function isInWeek(date, weekStart, weekEnd) {
    var d = toDateOnly(date);
    var ws = toDateOnly(weekStart);
    var we = toDateOnly(weekEnd);
    return d >= ws && d <= we;
}
function parsePaymentCurve(json) {
    try {
        return JSON.parse(json);
    }
    catch (_a) {
        return types_1.DEFAULT_PAYMENT_CURVE;
    }
}
function hashForecast(weeks) {
    var data = weeks.map(function (w) {
        var iso = isNaN(w.weekStart.getTime()) ? "INVALID" : w.weekStart.toISOString();
        return "".concat(iso, "|").concat(w.endCashExpected, "|").concat(w.endCashWorst, "|").concat(w.endCashBest);
    }).join(";");
    // Simple hash
    var hash = 0;
    for (var i = 0; i < data.length; i++) {
        var char = data.charCodeAt(i);
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
    var baseDueDate;
    var missingDate = false;
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
        // Missing date anomaly: assume today + 14 days
        baseDueDate = addDays(today, 14);
        missingDate = true;
    }
    // Step 2: Compute aging days
    var agingDays = daysBetween(baseDueDate, today);
    // Step 3: Determine payment curve shift (weeks)
    var shiftWeeks;
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
    var expectedDate = addDays(baseDueDate, shiftWeeks * 7);
    // Step 4: Determine confidence
    var confidence = "high";
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
    return { date: expectedDate, confidence: confidence, missingDate: missingDate };
}
// ─── Main Forecast Computation ──────────────────────────────────────────
function computeForecast(input) {
    var _a, _b, _c, _d, _e, _f;
    var today = input.asOfDate;
    var paymentCurve = parsePaymentCurve(input.assumptions.paymentCurveJson);
    var buffer = input.assumptions.bufferMin;
    // Build 13 weeks starting from Monday of current week
    var currentMonday = getMonday(today);
    var weeks = [];
    // Pre-allocate maps for all 13 weeks
    var invoicesByWeek = new Map();
    var billsByWeek = new Map();
    var recurringByWeek = new Map();
    var recurringInflowsByWeek = new Map();
    for (var w = 0; w < 13; w++) {
        invoicesByWeek.set(w, []);
        billsByWeek.set(w, []);
        recurringInflowsByWeek.set(w, []);
        recurringByWeek.set(w, []);
    }
    // ─── Allocate manual cash flow entries to weeks ────────────────────
    var manualEntriesByWeek = new Map();
    for (var w = 0; w < 13; w++)
        manualEntriesByWeek.set(w, []);
    for (var _i = 0, _g = (input.cashFlowEntries || []); _i < _g.length; _i++) {
        var entry = _g[_i];
        for (var w = 0; w < 13; w++) {
            var weekStart = addWeeks(currentMonday, w);
            var weekEnd = addDays(weekStart, 6);
            if (isInWeek(new Date(entry.targetDate), weekStart, weekEnd)) {
                manualEntriesByWeek.get(w).push(entry);
                break;
            }
        }
    }
    // ─── Allocate invoices to weeks ────────────────────────────────────
    for (var _h = 0, _j = input.invoices; _h < _j.length; _h++) {
        var inv = _j[_h];
        if (inv.status !== "open")
            continue;
        if (inv.markedPaid)
            continue;
        var amount = inv.amountOpen;
        if (inv.overrideAmount != null)
            amount = inv.overrideAmount;
        if (inv.partialPayment != null)
            amount = Math.max(0, amount - inv.partialPayment);
        if (amount <= 0)
            continue;
        var _k = computeExpectedPaymentDate(inv, today, paymentCurve), expectedDate = _k.date, confidence = _k.confidence;
        // Find which week this falls in
        for (var w = 0; w < 13; w++) {
            var weekStart = addWeeks(currentMonday, w);
            var weekEnd = addDays(weekStart, 6);
            if (isInWeek(expectedDate, weekStart, weekEnd)) {
                invoicesByWeek.get(w).push({
                    invoice: inv,
                    amount: amount,
                    confidence: confidence,
                    committed: confidence === "high",
                });
                break;
            }
        }
        // If beyond 13 weeks, it doesn't factor in
    }
    // ─── Allocate bills to weeks ───────────────────────────────────────
    for (var _l = 0, _m = input.bills; _l < _m.length; _l++) {
        var bill = _m[_l];
        if (bill.status !== "open")
            continue;
        if (bill.markedPaid)
            continue;
        var amount = bill.amountOpen;
        if (bill.overrideAmount != null)
            amount = bill.overrideAmount;
        if (amount <= 0)
            continue;
        var billDueDate = void 0;
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
        for (var w = 0; w < 13; w++) {
            var weekStart = addWeeks(currentMonday, w);
            var weekEnd = addDays(weekStart, 6);
            if (isInWeek(billDueDate, weekStart, weekEnd)) {
                billsByWeek.get(w).push({ bill: bill, amount: amount });
                break;
            }
        }
    }
    // ─── Allocate recurring outflows to weeks ──────────────────────────
    for (var _o = 0, _p = input.recurring; _o < _p.length; _o++) {
        var rec = _p[_o];
        if (!rec.isIncluded)
            continue;
        if (rec.direction !== "outflow")
            continue;
        var nextDate = rec.nextExpectedDate ? new Date(rec.nextExpectedDate) : null;
        if (!nextDate)
            continue;
        // Build a normalised set of skipped week-start dates (YYYY-MM-DD)
        var skipSet = new Set(((_a = rec.skipDates) !== null && _a !== void 0 ? _a : []).map(function (s) { return s.slice(0, 10); }));
        // Schedule occurrences for 13 weeks
        var d = new Date(nextDate);
        var endDate = addWeeks(currentMonday, 13);
        var windowStart = new Date(currentMonday);
        while (d <= endDate) {
            for (var w = 0; w < 13; w++) {
                var weekStart = addWeeks(currentMonday, w);
                var weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    // Skip this occurrence if it has been rescheduled away
                    var weekStartISO = isNaN(weekStart.getTime()) ? "0000-00-00" : weekStart.toISOString().slice(0, 10);
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
                var next = new Date(d);
                next.setMonth(next.getMonth() + 1);
                d = next;
            }
            else
                break; // irregular: only one occurrence
        }
    }
    var _loop_1 = function (oto) {
        for (var w = 0; w < 13; w++) {
            var weekStart = addWeeks(currentMonday, w);
            var weekEnd = addDays(weekStart, 6);
            if (isInWeek(oto.weekStart, weekStart, weekEnd)) {
                var originalPattern = input.recurring.find(function (r) { return r.id === oto.patternId; });
                var syntheticPattern = {
                    id: oto.patternId,
                    direction: "outflow",
                    displayName: "".concat(oto.displayName, " (Rescheduled)"),
                    typicalAmount: oto.amount,
                    amountStdDev: 0,
                    cadence: "irregular",
                    nextExpectedDate: oto.weekStart,
                    confidence: (_c = originalPattern === null || originalPattern === void 0 ? void 0 : originalPattern.confidence) !== null && _c !== void 0 ? _c : "high",
                    category: (_d = originalPattern === null || originalPattern === void 0 ? void 0 : originalPattern.category) !== null && _d !== void 0 ? _d : "other",
                    isIncluded: true,
                    isCritical: (_e = originalPattern === null || originalPattern === void 0 ? void 0 : originalPattern.isCritical) !== null && _e !== void 0 ? _e : false,
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
    };
    // ─── Inject one-time outflows from rescheduled recurring items ─────────
    for (var _q = 0, _r = ((_b = input.oneTimeOutflows) !== null && _b !== void 0 ? _b : []); _q < _r.length; _q++) {
        var oto = _r[_q];
        _loop_1(oto);
    }
    // ─── Add Payroll Assumption to recurring outflows ──────────────────
    if (input.assumptions.payrollAllInAmount && input.assumptions.payrollNextDate) {
        var d = new Date(input.assumptions.payrollNextDate);
        var amount = input.assumptions.payrollAllInAmount;
        var cadence = input.assumptions.payrollCadence || "biweekly";
        var endDate = addWeeks(currentMonday, 13);
        var windowStart = new Date(currentMonday);
        var payrollPattern = {
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
        };
        while (d <= endDate) {
            for (var w = 0; w < 13; w++) {
                var weekStart = addWeeks(currentMonday, w);
                var weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    recurringByWeek.get(w).push({ pattern: payrollPattern, amount: amount });
                    break;
                }
            }
            if (cadence === "weekly")
                d = addDays(d, 7);
            else if (cadence === "biweekly")
                d = addDays(d, 14);
            else if (cadence === "monthly") {
                var next = new Date(d);
                next.setMonth(next.getMonth() + 1);
                d = next;
            }
            else
                break;
        }
    }
    // ─── Add Rent Assumption to recurring outflows ─────────────────────
    if (input.assumptions.rentMonthlyAmount && input.assumptions.rentDayOfMonth) {
        var amount = input.assumptions.rentMonthlyAmount;
        var day = input.assumptions.rentDayOfMonth;
        var endDate = addWeeks(currentMonday, 13);
        var rentPattern = {
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
        };
        var d = new Date(currentMonday);
        d.setDate(day);
        // If the day already passed this month, start next month
        if (d < currentMonday)
            d.setMonth(d.getMonth() + 1);
        while (d <= endDate) {
            for (var w = 0; w < 13; w++) {
                var weekStart = addWeeks(currentMonday, w);
                var weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    recurringByWeek.get(w).push({ pattern: rentPattern, amount: amount });
                    break;
                }
            }
            var next = new Date(d);
            next.setMonth(next.getMonth() + 1);
            d = next;
        }
    }
    // ─── Allocate recurring inflows to weeks ───────────────────────────
    for (var _s = 0, _t = input.recurring; _s < _t.length; _s++) {
        var rec = _t[_s];
        if (!rec.isIncluded)
            continue;
        if (rec.direction !== "inflow")
            continue;
        var nextDate = rec.nextExpectedDate ? new Date(rec.nextExpectedDate) : null;
        if (!nextDate)
            continue;
        var d = new Date(nextDate);
        var endDate = addWeeks(currentMonday, 13);
        var windowStart = new Date(currentMonday);
        while (d <= endDate) {
            for (var w = 0; w < 13; w++) {
                var weekStart = addWeeks(currentMonday, w);
                var weekEnd = addDays(weekStart, 6);
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
                var next = new Date(d);
                next.setMonth(next.getMonth() + 1);
                d = next;
            }
            else
                break;
        }
    }
    // ─── Build weeks ──────────────────────────────────────────────────
    var runningCashExpected = input.adjustedOpeningCash;
    var runningCashBest = input.adjustedOpeningCash;
    var runningCashWorst = input.adjustedOpeningCash;
    var lowestExpected = runningCashExpected;
    var lowestWorst = runningCashWorst;
    var constraintWeek = null;
    var worstConstraintWeek = null;
    var expectedRunOut = null;
    var worstRunOut = null;
    for (var w = 0; w < 13; w++) {
        var weekStart = addWeeks(currentMonday, w);
        var weekEnd = addDays(weekStart, 6);
        var weekInvoices = invoicesByWeek.get(w) || [];
        var weekBills = billsByWeek.get(w) || [];
        var weekRecurring = recurringByWeek.get(w) || [];
        var weekRecurringInflows = recurringInflowsByWeek.get(w) || [];
        var weekManualEntries = manualEntriesByWeek.get(w) || [];
        // ── Determine zone ──────────────────────────────────────────
        // RULE: committed items always produce "committed" zone regardless
        // of week number or bank baseline availability.
        var hasCommittedInvoices = weekInvoices.some(function (i) { return i.committed; });
        var hasCommittedBills = weekBills.length > 0;
        // High-confidence recurring (payroll, rent, loan) are committed anchors
        var hasCommittedRecurring = weekRecurring.some(function (r) { return r.pattern.confidence === "high"; });
        var hasCommittedData = hasCommittedInvoices || hasCommittedBills || hasCommittedRecurring;
        var zone = void 0;
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
        var inflowBreakdown = [];
        var inflowExpected = 0;
        var inflowBest = 0;
        var inflowWorst = 0;
        for (var _u = 0, weekInvoices_1 = weekInvoices; _u < weekInvoices_1.length; _u++) {
            var item = weekInvoices_1[_u];
            inflowExpected += item.amount;
            inflowBest += item.amount * (item.confidence === "high" ? 1.0 : item.confidence === "med" ? 1.1 : 1.2);
            inflowWorst += item.amount * (item.confidence === "high" ? 1.0 : item.confidence === "med" ? 0.5 : 0.2);
            inflowBreakdown.push({
                label: "".concat(item.invoice.customerName, " (").concat(item.invoice.invoiceNo, ")"),
                amount: item.amount,
                type: item.invoice.overrideExpectedDate ? "overridden" : (item.committed ? "committed" : "assumed"),
                sourceType: "invoice",
                sourceId: item.invoice.id,
                confidence: item.confidence,
                section: "AR Receipts",
            });
        }
        // Recurring inflows
        for (var _v = 0, weekRecurringInflows_1 = weekRecurringInflows; _v < weekRecurringInflows_1.length; _v++) {
            var item = weekRecurringInflows_1[_v];
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
                metadata: item.meta,
            });
        }
        // Manual custom inflows (from Cash Adjustments)
        for (var _w = 0, weekManualEntries_1 = weekManualEntries; _w < weekManualEntries_1.length; _w++) {
            var entry = weekManualEntries_1[_w];
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
                confidence: "high",
                section: "Cat: ".concat(entry.categoryName),
            });
        }
        // ── Baseline Gap-Filling Fade logic ──
        // Asymmetric fading: We aggressively fade *uncertain future revenue* downwards over time,
        // but we hold *variable spend* flat (or inflate it) to remain conservative in later weeks.
        var revenueFade = 1.0;
        var spendFade = 1.0;
        if (w >= 4 && w <= 7) {
            revenueFade = 0.85; // Weeks 5-8
            spendFade = 1.0; // Expected spend persists
        }
        else if (w >= 8) {
            revenueFade = 0.70; // Weeks 9-13
            spendFade = 1.05; // Expected spend slightly inflates due to uncertainty
        }
        var safetyMargin = (_f = input.assumptions.projectionSafetyMargin) !== null && _f !== void 0 ? _f : 1.0;
        var inflowMultiplier = revenueFade * safetyMargin;
        // Inverse for outflows: when margin is low (conservative), outflow should be high.
        // We use (2 - safetyMargin) to keep the 0.5-1.5 range symmetric around 1.0.
        var outflowMultiplier = spendFade * (2 - safetyMargin);
        // Baseline inflow bucket — "Gap-Filling" logic:
        // Instead of showing bank history ONLY when there are zero AR invoices, we now show 
        // the "Gap" between your scheduled inflows and your historical bank average. 
        // This creates a smoother 13-week runway by assuming that if you have weak AR 
        // scheduled for a future week, more is coming to meet your average.
        var scheduledInflowSum = inflowBreakdown.reduce(function (s, i) { return s + i.amount; }, 0);
        var baselineInflowWeekly = (input.baselineInflowWeekly || 0) * inflowMultiplier;
        var inflowGap = Math.max(0, baselineInflowWeekly - scheduledInflowSum);
        if (input.hasBankBaseline && inflowGap > 0) {
            inflowExpected += inflowGap;
            inflowBest += inflowGap * (1 + (input.baselineInflowBand || 0.1));
            inflowWorst += inflowGap * (1 - (input.baselineInflowBand || 0.15));
            inflowBreakdown.push({
                label: "Projected inflow (risk-adjusted smoothing)",
                amount: inflowGap,
                type: "assumed",
                sourceType: "baseline",
                confidence: "low",
                section: "Baseline Inflow",
            });
        }
        // flag for variable outflow logic later
        var addedAnyInflowBaseline = (input.hasBankBaseline && inflowGap > 0) || (input.hasBankBaseline && scheduledInflowSum === 0);
        // ── Outflows ────────────────────────────────────────────────
        var outflowBreakdown = [];
        var outflowExpected = 0;
        var outflowBest = 0;
        var outflowWorst = 0;
        // Bills
        for (var _x = 0, weekBills_1 = weekBills; _x < weekBills_1.length; _x++) {
            var item = weekBills_1[_x];
            outflowExpected += item.amount;
            outflowBest += item.amount;
            outflowWorst += item.amount;
            outflowBreakdown.push({
                label: "".concat(item.bill.vendorName, " (").concat(item.bill.billNo, ")"),
                amount: item.amount,
                type: item.bill.overrideDueDate ? "overridden" : "committed",
                sourceType: "bill",
                sourceId: item.bill.id,
                confidence: "high",
                section: "AP Bills",
            });
        }
        // Recurring outflows
        for (var _y = 0, weekRecurring_1 = weekRecurring; _y < weekRecurring_1.length; _y++) {
            var item = weekRecurring_1[_y];
            var stdRatio = item.pattern.typicalAmount > 0
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
                metadata: item.meta,
            });
        }
        // Manual custom outflows (from Cash Adjustments)
        for (var _z = 0, weekManualEntries_2 = weekManualEntries; _z < weekManualEntries_2.length; _z++) {
            var entry = weekManualEntries_2[_z];
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
                confidence: "high",
                section: "Cat: ".concat(entry.categoryName),
            });
        }
        // Fixed weekly outflow
        if (input.assumptions.fixedWeeklyOutflow > 0) {
            var fixed = input.assumptions.fixedWeeklyOutflow;
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
        // Variable outflow bucket — smoothly travels with the revenue.
        // We now fill the "Gap" between your real bills and the expected variable spend 
        // that typically accompanies your historical inflow average.
        var scheduledOutflowAllSum = outflowBreakdown.reduce(function (s, i) { return s + i.amount; }, 0);
        var baselineVarOutWeekly = (input.variableOutflowWeekly || 0) * outflowMultiplier;
        // Only top-up variable spend if we added an inflow baseline (meaning we are in 'projection' mode)
        // and we haven't already exceeded the historical spend average with real bills.
        var outflowGap = Math.max(0, baselineVarOutWeekly - scheduledOutflowAllSum);
        if (addedAnyInflowBaseline && outflowGap > 0) {
            outflowExpected += outflowGap;
            outflowBest += outflowGap * (1 - (input.variableOutflowBand || 0.1));
            outflowWorst += outflowGap * (1 + (input.variableOutflowBand || 0.2));
            outflowBreakdown.push({
                label: "Projected variable spend (risk-adjusted smoothing)",
                amount: outflowGap,
                type: "assumed",
                sourceType: "baseline",
                confidence: "med",
                section: "Baseline Outflow",
            });
        }
        // Push payroll to the top of the outflows list
        outflowBreakdown.sort(function (a, b) {
            var aIsPayroll = a.label.toLowerCase().includes("payroll");
            var bIsPayroll = b.label.toLowerCase().includes("payroll");
            if (aIsPayroll && !bIsPayroll)
                return -1;
            if (!aIsPayroll && bIsPayroll)
                return 1;
            return 0;
        });
        // ── Compute end cash ────────────────────────────────────────
        var endCashExpected = runningCashExpected + inflowExpected - outflowExpected;
        var endCashBest = runningCashBest + inflowBest - outflowBest;
        var endCashWorst = runningCashWorst + inflowWorst - outflowWorst;
        // ── Confidence score per week ───────────────────────────────
        var weekConfidence = 100;
        if (zone === "pattern")
            weekConfidence -= 10;
        if (zone === "uncertain")
            weekConfidence -= 25;
        // Reduce for high-risk invoices in this week
        var highRiskPct = weekInvoices.filter(function (i) { return i.confidence === "low"; }).length / Math.max(1, weekInvoices.length);
        if (highRiskPct > 0.25)
            weekConfidence -= 15;
        weekConfidence = Math.max(0, Math.min(100, weekConfidence));
        // ── Worst-case driver: find largest expected→worst gap contributor ──
        // For outflows: worst > expected = bad; For inflows: worst < expected = bad
        var worstCaseDriver = null;
        var largestDelta = 0;
        for (var _0 = 0, outflowBreakdown_1 = outflowBreakdown; _0 < outflowBreakdown_1.length; _0++) {
            var item = outflowBreakdown_1[_0];
            // Outflow worst > expected means larger drain
            // We approximate per-item worst as item.amount * (1 + band) for assumed items
            var itemWorstDelta = item.type === "assumed" ? item.amount * 0.2 : 0;
            if (itemWorstDelta > largestDelta) {
                largestDelta = itemWorstDelta;
                worstCaseDriver = item.label;
            }
        }
        for (var _1 = 0, inflowBreakdown_1 = inflowBreakdown; _1 < inflowBreakdown_1.length; _1++) {
            var item = inflowBreakdown_1[_1];
            // Inflow worst < expected means less cash
            var itemWorstDelta = item.confidence === "low"
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
            weekStart: weekStart,
            weekEnd: weekEnd,
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
            zone: zone,
            confidenceScore: weekConfidence,
            breakdown: { inflows: inflowBreakdown, outflows: outflowBreakdown },
            worstCaseDriver: worstCaseDriver,
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
        weeks: weeks,
        constraintWeek: constraintWeek,
        worstCaseConstraintWeek: worstConstraintWeek,
        expectedRunOutWeek: expectedRunOut,
        worstCaseRunOutWeek: worstRunOut,
        lowestExpectedBalance: Math.round(lowestExpected * 100) / 100,
        lowestWorstBalance: Math.round(lowestWorst * 100) / 100,
        forecastVersionHash: hashForecast(weeks),
    };
}
