// ─── Domain Types & Enums ───────────────────────────────────────────────
// Pure type definitions for Cash Flow Decision OS.
// These mirror the Prisma schema but are used throughout services/ and ui/
// to avoid coupling to the Prisma client directly.

// ── Enums ──────────────────────────────────────────────────────────────

export type CashAdjustmentType =
    | "pending_deposit"
    | "uncleared_check"
    | "restricted_cash"
    | "other";

export type RiskTag = "low" | "med" | "high";

export type Criticality = "critical" | "normal";

export type InvoiceStatus = "open" | "paid" | "void";

export type PayrollCadence = "weekly" | "biweekly";

export type TransactionDirection = "inflow" | "outflow";

export type RecurringCadence = "weekly" | "biweekly" | "monthly" | "irregular";

export type ConfidenceLevel = "high" | "med" | "low";

export type RecurringCategory =
    | "payroll"
    | "rent"
    | "loan"
    | "subscription"
    | "utilities"
    | "fuel"
    | "materials"
    | "taxes"
    | "card_payment"
    | "other";

export type MappingKind = "ar" | "ap" | "bank";

export type OverrideType =
    | "partial_payment"
    | "mark_paid"
    | "delay_due_date"
    | "adjust_amount"
    | "add_one_time_outflow"
    | "add_one_time_inflow"
    | "set_expected_payment_date"
    | "set_bill_due_date"
    | "set_customer_delay"
    | "set_vendor_criticality"
    | "set_recurring_pattern"
    | "toggle_recurring_included"
    | "set_payroll"
    | "set_rent"
    | "set_fixed_outflow"
    | "add_cash_adjustment"
    | "skip_recurring_occurrence";

export type OverrideTargetType =
    | "invoice"
    | "bill"
    | "assumption"
    | "cash"
    | "customer"
    | "vendor"
    | "recurring"
    | "baseline";

export type OverrideStatus = "active" | "orphaned" | "archived";

export type ChangeSource = "user_ui" | "command_box" | "system";

export type ForecastZone = "committed" | "pattern" | "uncertain";

export type ActionType =
    | "collect_ar"
    | "delay_ap"
    | "reduce_outflows"
    | "add_cash_adjustment"
    | "other"
    | "risk_alert";

export type ActionPriority = "p1" | "p2" | "p3";

export type ImpactCertainty = "high" | "med" | "low";

// ── Payment Curve ──────────────────────────────────────────────────────

export interface PaymentCurve {
    current: number;     // weeks shift for current invoices
    "1-14": number;      // weeks shift for 1–14 days overdue
    "15-30": number;     // weeks shift for 15–30 days overdue
    "31-60": number;     // weeks shift for 31–60 days overdue
    "61+": number;       // weeks shift for 61+ days overdue
}

export const DEFAULT_PAYMENT_CURVE: PaymentCurve = {
    current: 0,
    "1-14": 1,
    "15-30": 2,
    "31-60": 3,
    "61+": 4,
};

// ── Forecast Week Breakdown ────────────────────────────────────────────

export interface WeekBreakdownItem {
    label: string;
    amount: number;
    type: "committed" | "assumed" | "overridden" | "rescheduled";
    sourceType: OverrideTargetType | "variable" | "manual";
    sourceId?: string;
    confidence: ConfidenceLevel;
    section?: string; // e.g. "AR Receipts", "AP Bills", "Recurring Commitments", "Baseline Inflow", etc.
    metadata?: any;
}

export interface WeekBreakdown {
    inflows: WeekBreakdownItem[];
    outflows: WeekBreakdownItem[];
}


// ── Confidence Scoring ─────────────────────────────────────────────────

export interface ConfidenceResult {
    score: number;                // 0–100
    label: ConfidenceLevel;
    reasons: string[];
}

export interface ActionReasoning {
    constraintWeekStart: string;
    gapAmountExpected: number;
    gapAmountWorst: number;
    selectedTargets: string[];
    impactAmount: number;
    impactCertainty: ImpactCertainty;
}

// ── Forecast Assumptions ───────────────────────────────────────────────

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
    projectionSafetyMargin: number; // Added for skepticism logic
}

// ── Scenario Impact Delta ──────────────────────────────────────────────

export interface ScenarioImpactDelta {
    constraintWeekDelta: number;           // e.g. +5000 = improves by $5k
    worstCaseRunwayBefore: number | null;  // week number or null
    worstCaseRunwayAfter: number | null;
}

// ── Mapping Profile Shape ──────────────────────────────────────────────

export interface ColumnMapping {
    [targetField: string]: string; // targetField -> source column name
}

// ── Cash Reality Check ─────────────────────────────────────────────────

export function getCashMismatchThreshold(bankBalance: number): number {
    const pct = bankBalance * 0.02;
    return Math.max(500, Math.min(5000, Math.max(2000, pct)));
}
