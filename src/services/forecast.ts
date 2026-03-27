// services/forecast.ts – 13-week cash flow forecast engine
// Pure deterministic logic. No React, no DB imports.

import type {
    PaymentCurve,
    ForecastZone,
    ConfidenceLevel,
    WeekBreakdown,
    WeekBreakdownItem,
    OverrideTargetType,
} from "@/domain/types";
import { DEFAULT_PAYMENT_CURVE } from "@/domain/types";

// ─── Input Types ────────────────────────────────────────────────────────

export interface ForecastInvoice {
    id: string;
    customerName: string;
    invoiceNo: string;
    amountOpen: number;
    invoiceDate: Date | null;
    dueDate: Date | null;
    daysPastDue: number | null;
    status: string;
    metaJson: string | null;
    // From CustomerProfile
    typicalDelayWeeks?: number | null;
    riskTag?: string;
    // From overrides
    overrideExpectedDate?: Date | null;
    overrideAmount?: number | null;
    markedPaid?: boolean;
    partialPayment?: number | null;
}

export interface ForecastBill {
    id: string;
    vendorName: string;
    billNo: string;
    amountOpen: number;
    billDate: Date | null;
    dueDate: Date | null;
    daysPastDue: number | null;
    status: string;
    // From VendorProfile
    criticality?: string;
    // From overrides
    overrideDueDate?: Date | null;
    overrideAmount?: number | null;
    markedPaid?: boolean;
}

export interface ForecastRecurring {
    id: string;
    direction: "inflow" | "outflow";
    displayName: string;
    typicalAmount: number;
    amountStdDev: number;
    cadence: string;
    nextExpectedDate: Date | null;
    confidence: ConfidenceLevel;
    category: string;
    isIncluded: boolean;
    isCritical: boolean;
    /** ISO date strings (week-start Mondays) for which this occurrence should be skipped */
    skipDates?: string[];
}

export interface ForecastAssumptions {
    bufferMin: number;
    fixedWeeklyOutflow: number;
    payrollCadence: string;
    payrollAllInAmount: number | null;
    payrollNextDate: Date | null;
    rentMonthlyAmount: number | null;
    rentDayOfMonth: number | null;
    paymentCurveJson: string;
    highRiskAgingDays: number;
    projectionSafetyMargin?: number;
}

export interface ForecastInput {
    adjustedOpeningCash: number;
    bankBalance: number;
    adjustmentsTotal: number;
    asOfDate: Date;
    invoices: ForecastInvoice[];
    bills: ForecastBill[];
    recurring: ForecastRecurring[];
    assumptions: ForecastAssumptions;
    hasBankBaseline: boolean;
    variableOutflowWeekly: number;     // avg variable outflow from baseline
    variableOutflowBand: number;       // +/- band (e.g., 0.2 = 20%)
    baselineInflowWeekly: number;      // avg inflow from baseline
    baselineInflowBand: number;        // +/- band
    /** One-time outflows from rescheduled recurring items: { patternId, displayName, amount, weekStart, sourceWeekStart } */
    oneTimeOutflows?: Array<{ patternId: string; displayName: string; amount: number; weekStart: Date; sourceWeekStart?: string | null }>;
    /** Manual cash flow entries from the Cash Adjustments screen */
    cashFlowEntries?: Array<{ categoryId: string; categoryName: string; direction: "inflow" | "outflow"; label: string; amount: number; weekNumber: number }>;
}
 
interface RecurrenceInstance {
    pattern: ForecastRecurring;
    amount: number;
    rescheduled?: boolean;
    meta?: any;
}
 
// ─── Output Types ───────────────────────────────────────────────────────

export interface ForecastWeekResult {
    weekNumber: number;
    weekStart: Date;
    weekEnd: Date;
    startCash: number;
    inflowsExpected: number;
    outflowsExpected: number;
    endCashExpected: number;
    inflowsBest: number;
    outflowsBest: number;
    endCashBest: number;
    inflowsWorst: number;
    outflowsWorst: number;
    endCashWorst: number;
    zone: ForecastZone;
    confidenceScore: number;
    breakdown: WeekBreakdown;
    worstCaseDriver: string | null; // label of the largest expected→worst delta contributor
}

export interface ForecastResult {
    weeks: ForecastWeekResult[];
    constraintWeek: number | null;        // first week where endCashExpected < buffer
    worstCaseConstraintWeek: number | null; // first week where endCashWorst < 0
    expectedRunOutWeek: number | null;     // first week where endCashExpected < 0
    worstCaseRunOutWeek: number | null;    // first week where endCashWorst < 0
    lowestExpectedBalance: number;
    lowestWorstBalance: number;
    forecastVersionHash: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────

export function getMonday(d: Date): Date {
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

export function addWeeks(d: Date, n: number): Date {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n * 7);
    return dt;
}

export function addDays(d: Date, n: number): Date {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
}

function daysBetween(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** Normalize a Date to midnight UTC on its calendar date, eliminating
 *  time-of-day effects when comparing against week boundaries.
 *  This prevents timezone offsets from shifting an item into the wrong week
 *  (e.g. a recurring item stored as "Mar 22 23:00 UTC" but logically due on
 *  Mar 22 local should still land in the week that contains Mar 22). */
function toDateOnly(d: Date): Date {
    const dt = new Date(d);
    if (dt.getUTCHours() === 0 && dt.getUTCMinutes() === 0 && dt.getUTCSeconds() === 0) {
        return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    }
    return new Date(Date.UTC(dt.getFullYear(), dt.getMonth(), dt.getDate()));
}

export function isInWeek(date: Date, weekStart: Date, weekEnd: Date): boolean {
    const d  = toDateOnly(date);
    const ws = toDateOnly(weekStart);
    const we = toDateOnly(weekEnd);
    return d >= ws && d <= we;
}


export function parsePaymentCurve(json: string): PaymentCurve {
    try {
        return JSON.parse(json) as PaymentCurve;
    } catch {
        return DEFAULT_PAYMENT_CURVE;
    }
}

function hashForecast(weeks: ForecastWeekResult[]): string {
    const data = weeks.map(w =>
        `${w.weekStart.toISOString()}|${w.endCashExpected}|${w.endCashWorst}|${w.endCashBest}`
    ).join(";");
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

export function computeExpectedPaymentDate(
    invoice: ForecastInvoice,
    today: Date,
    paymentCurve: PaymentCurve,
): { date: Date; confidence: ConfidenceLevel; missingDate: boolean } {
    // Override takes priority
    if (invoice.overrideExpectedDate) {
        return { date: invoice.overrideExpectedDate, confidence: "high", missingDate: false };
    }

    // Step 1: Determine baseDueDate
    let baseDueDate: Date;
    let missingDate = false;

    if (invoice.dueDate) {
        baseDueDate = new Date(invoice.dueDate);
    } else if (invoice.invoiceDate) {
        baseDueDate = addDays(new Date(invoice.invoiceDate), 30);
    } else if (invoice.daysPastDue != null) {
        baseDueDate = addDays(today, -invoice.daysPastDue);
    } else {
        // Missing date anomaly: assume today + 14 days
        baseDueDate = addDays(today, 14);
        missingDate = true;
    }

    // Step 2: Compute aging days
    const agingDays = daysBetween(baseDueDate, today);

    // Step 3: Determine payment curve shift (weeks)
    let shiftWeeks: number;
    if (invoice.typicalDelayWeeks != null) {
        // Customer profile overrides global curve
        shiftWeeks = invoice.typicalDelayWeeks;
    } else if (agingDays <= 0) {
        shiftWeeks = paymentCurve.current;
    } else if (agingDays <= 14) {
        shiftWeeks = paymentCurve["1-14"];
    } else if (agingDays <= 30) {
        shiftWeeks = paymentCurve["15-30"];
    } else if (agingDays <= 60) {
        shiftWeeks = paymentCurve["31-60"];
    } else {
        shiftWeeks = paymentCurve["61+"];
    }

    const expectedDate = addDays(baseDueDate, shiftWeeks * 7);

    // Step 4: Determine confidence
    let confidence: ConfidenceLevel = "high";
    if (missingDate) {
        confidence = "low";
    } else if (agingDays > 60) {
        confidence = "low";
    } else if (agingDays > 14) {
        confidence = "med";
    }

    // High risk tag lowers confidence
    if (invoice.riskTag === "high") {
        confidence = "low";
    }

    return { date: expectedDate, confidence, missingDate };
}

// ─── Main Forecast Computation ──────────────────────────────────────────

export function computeForecast(input: ForecastInput): ForecastResult {
    const today = input.asOfDate;
    const paymentCurve = parsePaymentCurve(input.assumptions.paymentCurveJson);
    const buffer = input.assumptions.bufferMin;

    // Build 13 weeks starting from Monday of current week
    const currentMonday = getMonday(today);
    const weeks: ForecastWeekResult[] = [];

    // Pre-allocate maps for all 13 weeks
    const invoicesByWeek = new Map<number, Array<{ invoice: ForecastInvoice; amount: number; confidence: ConfidenceLevel; committed: boolean }>>();
    const billsByWeek = new Map<number, Array<{ bill: ForecastBill; amount: number }>>();
    const recurringByWeek = new Map<number, Array<RecurrenceInstance>>();
    const recurringInflowsByWeek = new Map<number, Array<RecurrenceInstance>>();
    for (let w = 0; w < 13; w++) {
        invoicesByWeek.set(w, []);
        billsByWeek.set(w, []);
        recurringInflowsByWeek.set(w, []);
        recurringByWeek.set(w, []);
    }

    // ─── Allocate manual cash flow entries to weeks ────────────────────
    const manualEntriesByWeek = new Map<number, Array<any>>();
    for (let w = 0; w < 13; w++) manualEntriesByWeek.set(w, []);
    for (const entry of (input.cashFlowEntries || [])) {
        if (entry.weekNumber >= 1 && entry.weekNumber <= 13) {
            manualEntriesByWeek.get(entry.weekNumber - 1)!.push(entry);
        }
    }

    // ─── Allocate invoices to weeks ────────────────────────────────────
    for (const inv of input.invoices) {
        if (inv.status !== "open") continue;
        if (inv.markedPaid) continue;

        let amount = inv.amountOpen;
        if (inv.overrideAmount != null) amount = inv.overrideAmount;
        if (inv.partialPayment != null) amount = Math.max(0, amount - inv.partialPayment);
        if (amount <= 0) continue;

        const { date: expectedDate, confidence } = computeExpectedPaymentDate(inv, today, paymentCurve);

        // Find which week this falls in
        for (let w = 0; w < 13; w++) {
            const weekStart = addWeeks(currentMonday, w);
            const weekEnd = addDays(weekStart, 6);
            if (isInWeek(expectedDate, weekStart, weekEnd)) {
                invoicesByWeek.get(w)!.push({
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
        if (bill.status !== "open") continue;
        if (bill.markedPaid) continue;

        let amount = bill.amountOpen;
        if (bill.overrideAmount != null) amount = bill.overrideAmount;
        if (amount <= 0) continue;

        let billDueDate: Date;
        if (bill.overrideDueDate) {
            billDueDate = new Date(bill.overrideDueDate);
        } else if (bill.dueDate) {
            billDueDate = new Date(bill.dueDate);
        } else if (bill.billDate) {
            billDueDate = addDays(new Date(bill.billDate), 30);
        } else {
            billDueDate = addDays(today, 7); // fallback
        }

        for (let w = 0; w < 13; w++) {
            const weekStart = addWeeks(currentMonday, w);
            const weekEnd = addDays(weekStart, 6);
            if (isInWeek(billDueDate, weekStart, weekEnd)) {
                billsByWeek.get(w)!.push({ bill, amount });
                break;
            }
        }
    }

    // ─── Allocate recurring outflows to weeks ──────────────────────────
    for (const rec of input.recurring) {
        if (!rec.isIncluded) continue;
        if (rec.direction !== "outflow") continue;

        let nextDate = rec.nextExpectedDate ? new Date(rec.nextExpectedDate) : null;
        if (!nextDate) continue;

        // Build a normalised set of skipped week-start dates (YYYY-MM-DD)
        const skipSet = new Set((rec.skipDates ?? []).map(s => s.slice(0, 10)));

        // Schedule occurrences for 13 weeks
        let d = new Date(nextDate);
        const endDate = addWeeks(currentMonday, 13);
        const windowStart = new Date(currentMonday);

        // Backtrack to first potential occurrence in/before the window
        while (d > windowStart) {
            if (rec.cadence === "weekly") d = addDays(d, -7);
            else if (rec.cadence === "biweekly") d = addDays(d, -14);
            else if (rec.cadence === "monthly") {
                const prev = new Date(d);
                prev.setMonth(prev.getMonth() - 1);
                d = prev;
            } else break;
        }

        while (d <= endDate) {
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    // Skip this occurrence if it has been rescheduled away
                    const weekStartISO = weekStart.toISOString().slice(0, 10);
                    if (!skipSet.has(weekStartISO)) {
                        recurringByWeek.get(w)!.push({ pattern: rec, amount: rec.typicalAmount });
                    }
                    break;
                }
            }

            // Advance to next occurrence
            if (rec.cadence === "weekly") d = addDays(d, 7);
            else if (rec.cadence === "biweekly") d = addDays(d, 14);
            else if (rec.cadence === "monthly") {
                const next = new Date(d);
                next.setMonth(next.getMonth() + 1);
                d = next;
            } else break; // irregular: only one occurrence
        }
    }

    // ─── Inject one-time outflows from rescheduled recurring items ─────────
    for (const oto of (input.oneTimeOutflows ?? [])) {
        for (let w = 0; w < 13; w++) {
            const weekStart = addWeeks(currentMonday, w);
            const weekEnd = addDays(weekStart, 6);
            if (isInWeek(oto.weekStart, weekStart, weekEnd)) {
                const originalPattern = input.recurring.find((r: ForecastRecurring) => r.id === oto.patternId);
                const syntheticPattern: ForecastRecurring = {
                    id: oto.patternId,
                    direction: "outflow",
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
                recurringByWeek.get(w)!.push({ 
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

        // Backtrack payroll
        while (d > windowStart) {
            if (cadence === "weekly") d = addDays(d, -7);
            else if (cadence === "biweekly") d = addDays(d, -14);
            else if (cadence === "monthly") {
                const prev = new Date(d);
                prev.setMonth(prev.getMonth() - 1);
                d = prev;
            } else break;
        }

        const payrollPattern: ForecastRecurring = {
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
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    recurringByWeek.get(w)!.push({ pattern: payrollPattern, amount });
                    break;
                }
            }
            if (cadence === "weekly") d = addDays(d, 7);
            else if (cadence === "biweekly") d = addDays(d, 14);
            else if (cadence === "monthly") {
                const next = new Date(d);
                next.setMonth(next.getMonth() + 1);
                d = next;
            } else break;
        }
    }

    // ─── Add Rent Assumption to recurring outflows ─────────────────────
    if (input.assumptions.rentMonthlyAmount && input.assumptions.rentDayOfMonth) {
        const amount = input.assumptions.rentMonthlyAmount;
        const day = input.assumptions.rentDayOfMonth;
        const endDate = addWeeks(currentMonday, 13);
        const rentPattern: ForecastRecurring = {
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

        let d = new Date(currentMonday);
        d.setDate(day);
        // If the day already passed this month, start next month
        if (d < currentMonday) d.setMonth(d.getMonth() + 1);

        while (d <= endDate) {
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    recurringByWeek.get(w)!.push({ pattern: rentPattern, amount });
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
        if (!rec.isIncluded) continue;
        if (rec.direction !== "inflow") continue;

        let nextDate = rec.nextExpectedDate ? new Date(rec.nextExpectedDate) : null;
        if (!nextDate) continue;

        let d = new Date(nextDate);
        const endDate = addWeeks(currentMonday, 13);
        const windowStart = new Date(currentMonday);

        // Backtrack to first potential occurrence in/before the window
        while (d > windowStart) {
            if (rec.cadence === "weekly") d = addDays(d, -7);
            else if (rec.cadence === "biweekly") d = addDays(d, -14);
            else if (rec.cadence === "monthly") {
                const prev = new Date(d);
                prev.setMonth(prev.getMonth() - 1);
                d = prev;
            } else break;
        }

        while (d <= endDate) {
            for (let w = 0; w < 13; w++) {
                const weekStart = addWeeks(currentMonday, w);
                const weekEnd = addDays(weekStart, 6);
                if (isInWeek(d, weekStart, weekEnd)) {
                    recurringInflowsByWeek.get(w)!.push({ pattern: rec, amount: rec.typicalAmount });
                    break;
                }
            }
            if (rec.cadence === "weekly") d = addDays(d, 7);
            else if (rec.cadence === "biweekly") d = addDays(d, 14);
            else if (rec.cadence === "monthly") {
                const next = new Date(d);
                next.setMonth(next.getMonth() + 1);
                d = next;
            } else break;
        }
    }

    // ─── Build weeks ──────────────────────────────────────────────────
    let runningCashExpected = input.adjustedOpeningCash;
    let runningCashBest = input.adjustedOpeningCash;
    let runningCashWorst = input.adjustedOpeningCash;

    let lowestExpected = runningCashExpected;
    let lowestWorst = runningCashWorst;
    let constraintWeek: number | null = null;
    let worstConstraintWeek: number | null = null;
    let expectedRunOut: number | null = null;
    let worstRunOut: number | null = null;

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
        const hasCommittedRecurring = weekRecurring.some(
            r => r.pattern.confidence === "high"
        );
        const hasCommittedData = hasCommittedInvoices || hasCommittedBills || hasCommittedRecurring;
        let zone: ForecastZone;
        if (hasCommittedData) {
            zone = "committed";
        } else if (input.hasBankBaseline) {
            zone = w <= 6 ? "pattern" : "uncertain";
        } else {
            zone = "uncertain";
        }

        // ── Inflows ─────────────────────────────────────────────────
        const inflowBreakdown: WeekBreakdownItem[] = [];
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
                metadata: item.meta,
            });
        }

        // Manual custom inflows (from Cash Adjustments)
        for (const entry of weekManualEntries) {
            if (entry.direction !== "inflow") continue;
            inflowExpected += entry.amount;
            inflowBest += entry.amount;
            inflowWorst += entry.amount;

            inflowBreakdown.push({
                label: entry.label || entry.categoryName,
                amount: entry.amount,
                type: "committed",
                sourceType: "manual",
                confidence: "high",
                section: `Cat: ${entry.categoryName}`,
            });
        }

        // ── Baseline Gap-Filling Fade logic ──
        // Fade the base historical average depending on the distance in the future
        let temporalFade = 1.0;
        if (w >= 4 && w <= 7) temporalFade = 0.85; // Weeks 5-8
        else if (w >= 8) temporalFade = 0.70;      // Weeks 9-13
        
        const safetyMargin = input.assumptions.projectionSafetyMargin ?? 1.0;
        const effectiveMultiplier = temporalFade * safetyMargin;

        // Baseline inflow bucket — "Gap-Filling" logic:
        // Instead of showing bank history ONLY when there are zero AR invoices, we now show 
        // the "Gap" between your scheduled inflows and your historical bank average. 
        // This creates a smoother 13-week runway by assuming that if you have weak AR 
        // scheduled for a future week, more is coming to meet your average.
        const scheduledInflowSum = inflowBreakdown.reduce((s, i) => s + i.amount, 0);
        const baselineInflowWeekly = (input.baselineInflowWeekly || 0) * effectiveMultiplier;
        const inflowGap = Math.max(0, baselineInflowWeekly - scheduledInflowSum);

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
        const addedAnyInflowBaseline = (input.hasBankBaseline && inflowGap > 0) || (input.hasBankBaseline && scheduledInflowSum === 0);

        // ── Outflows ────────────────────────────────────────────────
        const outflowBreakdown: WeekBreakdownItem[] = [];
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
                metadata: item.meta,
            });
        }

        // Manual custom outflows (from Cash Adjustments)
        for (const entry of weekManualEntries) {
            if (entry.direction !== "outflow") continue;
            outflowExpected += entry.amount;
            outflowBest += entry.amount;
            outflowWorst += entry.amount;

            outflowBreakdown.push({
                label: entry.label || entry.categoryName,
                amount: entry.amount,
                type: "committed",
                sourceType: "manual",
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
                type: "assumed",        // it's a user-defined assumption, not a verified bill
                sourceType: "assumption",
                confidence: "med",
                section: "Fixed Weekly Assumption",
            });
        }

        // Variable outflow bucket — smoothly travels with the revenue.
        // We now fill the "Gap" between your real bills and the expected variable spend 
        // that typically accompanies your historical inflow average.
        const scheduledOutflowAllSum = outflowBreakdown.reduce((s, i) => s + i.amount, 0);
        const baselineVarOutWeekly = (input.variableOutflowWeekly || 0) * effectiveMultiplier;
        
        // Only top-up variable spend if we added an inflow baseline (meaning we are in 'projection' mode)
        // and we haven't already exceeded the historical spend average with real bills.
        const outflowGap = Math.max(0, baselineVarOutWeekly - scheduledOutflowAllSum);

        if (addedAnyInflowBaseline && outflowGap > 0) {
            outflowExpected += outflowGap;
            outflowBest += outflowGap * (1 - (input.variableOutflowBand || 0.1));
            outflowWorst += outflowGap * (1 + (input.variableOutflowBand || 0.2));

            outflowBreakdown.push({
                label: "Projected variable spend (risk-adjusted smoothing)",
                amount: outflowGap,
                type: "assumed",
                sourceType: "baseline" as OverrideTargetType,
                confidence: "med",
                section: "Baseline Outflow",
            });
        }

        // Push payroll to the top of the outflows list
        outflowBreakdown.sort((a, b) => {
            const aIsPayroll = a.label.toLowerCase().includes("payroll");
            const bIsPayroll = b.label.toLowerCase().includes("payroll");
            if (aIsPayroll && !bIsPayroll) return -1;
            if (!aIsPayroll && bIsPayroll) return 1;
            return 0;
        });

        // ── Compute end cash ────────────────────────────────────────
        const endCashExpected = runningCashExpected + inflowExpected - outflowExpected;
        const endCashBest = runningCashBest + inflowBest - outflowBest;
        const endCashWorst = runningCashWorst + inflowWorst - outflowWorst;

        // ── Confidence score per week ───────────────────────────────
        let weekConfidence = 100;
        if (zone === "pattern") weekConfidence -= 10;
        if (zone === "uncertain") weekConfidence -= 25;
        // Reduce for high-risk invoices in this week
        const highRiskPct = weekInvoices.filter(i => i.confidence === "low").length / Math.max(1, weekInvoices.length);
        if (highRiskPct > 0.25) weekConfidence -= 15;

        weekConfidence = Math.max(0, Math.min(100, weekConfidence));

        // ── Worst-case driver: find largest expected→worst gap contributor ──
        // For outflows: worst > expected = bad; For inflows: worst < expected = bad
        let worstCaseDriver: string | null = null;
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
        if (endCashExpected < lowestExpected) lowestExpected = endCashExpected;
        if (endCashWorst < lowestWorst) lowestWorst = endCashWorst;

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
