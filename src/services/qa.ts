// services/qa.ts – Data quality anomalies + confidence scoring with specific reason bullets
// Pure logic. No React, no DB imports.

import type { ConfidenceResult, ConfidenceLevel } from "@/domain/types";
import type { BaselineResult } from "./baseline";

export interface QAInput {
    invoices: Array<{
        id: string;
        customerName: string;
        invoiceNo: string;
        amountOpen: number;
        invoiceDate: Date | null;
        dueDate: Date | null;
        daysPastDue: number | null;
    }>;
    bills: Array<{
        id: string;
        vendorName: string;
        billNo: string;
        amountOpen: number;
        billDate: Date | null;
        dueDate: Date | null;
    }>;
    assumptions: {
        payrollAllInAmount: number | null;
        payrollNextDate: Date | null;
    };
    payrollPatternDetected: boolean;
    payrollPatternConfidence: ConfidenceLevel | null;
    hasBankData: boolean;
    arRefreshDate: Date | null;
    apRefreshDate: Date | null;
    baseline: BaselineResult | null;
    cashMismatchUnreconciled?: boolean;
}

export interface Anomaly {
    id: string;
    type: "duplicate" | "negative" | "extreme" | "missing_id" | "far_future" | "missing_date";
    severity: "warn" | "error";
    message: string;
    targetType: "invoice" | "bill";
    targetId: string;
}

export function detectAnomalies(input: QAInput): Anomaly[] {
    const anomalies: Anomaly[] = [];
    let idx = 0;

    // ── AR anomalies ──────────────────────────────────────────────────
    const invoiceAmounts = new Map<string, number[]>();
    const allInvoiceAmounts: number[] = [];

    for (const inv of input.invoices) {
        const key = `${inv.customerName}|${inv.invoiceNo}`;
        if (!invoiceAmounts.has(key)) invoiceAmounts.set(key, []);
        invoiceAmounts.get(key)!.push(inv.amountOpen);
        if (inv.amountOpen > 0) allInvoiceAmounts.push(inv.amountOpen);

        if (inv.amountOpen < 0) {
            anomalies.push({
                id: `anom-${idx++}`,
                type: "negative",
                severity: "warn",
                message: `Invoice ${inv.invoiceNo} has negative amount ($${inv.amountOpen.toLocaleString()})`,
                targetType: "invoice",
                targetId: inv.id,
            });
        }

        if (!inv.dueDate && !inv.invoiceDate && inv.daysPastDue == null) {
            anomalies.push({
                id: `anom-${idx++}`,
                type: "missing_date",
                severity: "warn",
                message: `Invoice ${inv.invoiceNo} (${inv.customerName}) has no date info — using fallback of +14 days`,
                targetType: "invoice",
                targetId: inv.id,
            });
        }

        if (inv.dueDate) {
            const daysAhead = Math.round((inv.dueDate.getTime() - Date.now()) / 86_400_000);
            if (daysAhead > 180) {
                anomalies.push({
                    id: `anom-${idx++}`,
                    type: "far_future",
                    severity: "warn",
                    message: `Invoice ${inv.invoiceNo} due date is ${daysAhead} days in the future (>180 days)`,
                    targetType: "invoice",
                    targetId: inv.id,
                });
            }
        }
    }

    for (const [key, amounts] of invoiceAmounts) {
        if (amounts.length > 1) {
            const [customer, invoiceNo] = key.split("|");
            const hasSameAmount = amounts.some((a, i) => amounts.indexOf(a) !== i);
            if (hasSameAmount) {
                anomalies.push({
                    id: `anom-${idx++}`,
                    type: "duplicate",
                    severity: "warn",
                    message: `Possible duplicate invoice ${invoiceNo} for ${customer} (same amount)`,
                    targetType: "invoice",
                    targetId: "",
                });
            }
        }
    }

    if (allInvoiceAmounts.length > 3) {
        const sorted = [...allInvoiceAmounts].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        for (const inv of input.invoices) {
            if (inv.amountOpen > median * 10) {
                anomalies.push({
                    id: `anom-${idx++}`,
                    type: "extreme",
                    severity: "warn",
                    message: `Invoice ${inv.invoiceNo} ($${inv.amountOpen.toLocaleString()}) is >10× median ($${median.toLocaleString()})`,
                    targetType: "invoice",
                    targetId: inv.id,
                });
            }
        }
    }

    // ── AP anomalies ──────────────────────────────────────────────────
    const billAmounts = new Map<string, number[]>();
    const allBillAmounts: number[] = [];

    for (const bill of input.bills) {
        const key = `${bill.vendorName}|${bill.billNo}`;
        if (!billAmounts.has(key)) billAmounts.set(key, []);
        billAmounts.get(key)!.push(bill.amountOpen);
        if (bill.amountOpen > 0) allBillAmounts.push(bill.amountOpen);

        if (bill.amountOpen < 0) {
            anomalies.push({
                id: `anom-${idx++}`,
                type: "negative",
                severity: "warn",
                message: `Bill ${bill.billNo} has negative amount ($${bill.amountOpen.toLocaleString()})`,
                targetType: "bill",
                targetId: bill.id,
            });
        }

        if (bill.dueDate) {
            const daysAhead = Math.round((bill.dueDate.getTime() - Date.now()) / 86_400_000);
            if (daysAhead > 180) {
                anomalies.push({
                    id: `anom-${idx++}`,
                    type: "far_future",
                    severity: "warn",
                    message: `Bill ${bill.billNo} due date is ${daysAhead} days in the future (>180 days)`,
                    targetType: "bill",
                    targetId: bill.id,
                });
            }
        }
    }

    for (const [key, amounts] of billAmounts) {
        if (amounts.length > 1) {
            const [vendor, billNo] = key.split("|");
            const hasSameAmount = amounts.some((a, i) => amounts.indexOf(a) !== i);
            if (hasSameAmount) {
                anomalies.push({
                    id: `anom-${idx++}`,
                    type: "duplicate",
                    severity: "warn",
                    message: `Possible duplicate bill ${billNo} for ${vendor} (same amount)`,
                    targetType: "bill",
                    targetId: "",
                });
            }
        }
    }

    if (allBillAmounts.length > 3) {
        const sorted = [...allBillAmounts].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        for (const bill of input.bills) {
            if (bill.amountOpen > median * 10) {
                anomalies.push({
                    id: `anom-${idx++}`,
                    type: "extreme",
                    severity: "warn",
                    message: `Bill ${bill.billNo} ($${bill.amountOpen.toLocaleString()}) is >10× median ($${median.toLocaleString()})`,
                    targetType: "bill",
                    targetId: bill.id,
                });
            }
        }
    }

    return anomalies;
}

// ─── Confidence scoring with specific reason bullets ──────────────────────

export function computeConfidence(input: QAInput, anomalies: Anomaly[]): ConfidenceResult {
    let score = 100;
    const reasons: string[] = [];
    const now = new Date();

    // ── Bank baseline ─────────────────────────────────────────────────
    if (!input.hasBankData) {
        score -= 10;
        reasons.push("No bank data — variable outflow/inflow uses placeholder defaults");
    } else if (input.baseline) {
        if (!input.baseline.hasSufficientHistory) {
            score -= 8;
            reasons.push(`Baseline uses placeholder — ${input.baseline.note}`);
        } else {
            // Baseline computed — this is positive, add no penalty, but report it
            reasons.push(`Baseline computed from ${input.baseline.weeksAnalyzed} weeks of bank history`);
        }
    }

    // ── AR staleness ──────────────────────────────────────────────────
    if (input.arRefreshDate) {
        const daysSince = Math.round((now.getTime() - input.arRefreshDate.getTime()) / 86_400_000);
        if (daysSince > 14) {
            score -= 20;
            reasons.push(`AR data is ${daysSince} days old (refresh recommended)`);
        } else if (daysSince > 7) {
            score -= 10;
            reasons.push(`AR data is ${daysSince} days old`);
        } else {
            reasons.push("AR data is up to date");
        }
    } else {
        score -= 5;
        reasons.push("AR refresh date unknown");
    }

    // ── AP staleness ──────────────────────────────────────────────────
    if (input.apRefreshDate) {
        const daysSince = Math.round((now.getTime() - input.apRefreshDate.getTime()) / 86_400_000);
        if (daysSince > 14) {
            score -= 20;
            reasons.push(`AP data is ${daysSince} days old (refresh recommended)`);
        } else if (daysSince > 7) {
            score -= 10;
            reasons.push(`AP data is ${daysSince} days old`);
        } else {
            reasons.push("AP data is up to date");
        }
    }

    // ── Missing dates on AR ────────────────────────────────────────────
    const missingDateCount = input.invoices.filter(
        i => !i.dueDate && !i.invoiceDate && i.daysPastDue == null
    ).length;
    if (input.invoices.length > 0 && missingDateCount > 0) {
        const pct = Math.round((missingDateCount / input.invoices.length) * 100);
        if (pct > 10) {
            score -= 15;
            reasons.push(`${missingDateCount} invoices (${pct}%) have no date — using fallback dates`);
        } else {
            score -= 5;
            reasons.push(`${missingDateCount} invoice(s) missing date info`);
        }
    }

    // ── Payroll ────────────────────────────────────────────────────────
    const payrollManual = input.assumptions.payrollAllInAmount != null && input.assumptions.payrollNextDate != null;
    const payrollDetectedHigh = input.payrollPatternDetected && input.payrollPatternConfidence === "high";
    const payrollDetectedMed = input.payrollPatternDetected && input.payrollPatternConfidence === "med";

    if (payrollManual) {
        reasons.push("Payroll confirmed (manual entry)");
    } else if (payrollDetectedHigh) {
        reasons.push("Payroll detected with high confidence from bank history");
    } else if (payrollDetectedMed) {
        score -= 10;
        reasons.push("Payroll detected (medium confidence) — confirm amount to improve accuracy");
    } else if (input.payrollPatternDetected) {
        score -= 15;
        reasons.push("Payroll pattern detected but confidence is low — please confirm");
    } else {
        score -= 20;
        reasons.push("Payroll not configured and not detected — outflows may be understated");
    }

    // ── High-risk AR concentration ────────────────────────────────────
    const highRiskAR = input.invoices.filter(i => (i.daysPastDue ?? 0) > 60);
    const totalAR = input.invoices.reduce((sum, i) => sum + i.amountOpen, 0);
    const highRiskTotal = highRiskAR.reduce((sum, i) => sum + i.amountOpen, 0);
    if (totalAR > 0 && highRiskTotal / totalAR > 0.25) {
        const pct = Math.round((highRiskTotal / totalAR) * 100);
        score -= 15;
        reasons.push(`${pct}% of AR ($${highRiskTotal.toLocaleString()}) is 60+ days overdue (high-risk)`);
    }

    // ── Anomalies ──────────────────────────────────────────────────────
    if (anomalies.length > 10) {
        score -= 10;
        reasons.push(`${anomalies.length} data quality issues detected`);
    } else if (anomalies.length > 0) {
        reasons.push(`${anomalies.length} data anomaly/anomalies noted`);
    }

    // ── Cash mismatch ──────────────────────────────────────────────────
    if (input.cashMismatchUnreconciled) {
        score -= 15;
        reasons.push("Cash reality check not reconciled — starting balance may not be accurate");
    }

    score = Math.max(0, Math.min(100, score));

    let label: ConfidenceLevel;
    if (score >= 70) label = "high";
    else if (score >= 40) label = "med";
    else label = "low";

    return { score, label, reasons };
}
