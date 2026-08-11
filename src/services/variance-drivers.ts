// services/variance-drivers.ts
// Deterministic variance driver engine.
// Pure read-only analysis — 4 DB queries, no writes, no AI.

import prisma from "@/db/prisma";
import { getManagerialVisibility } from "./managerial-visibility";
import type { WeekBreakdown, WeekBreakdownItem } from "@/domain/types";

// ─── Output types ────────────────────────────────────────────────────────────

export interface DriverItem {
    label: string;
    sourceType: string;
    sourceId: string | null;
    expectedAmount: number;      // amount from checkpoint breakdownJson
    currentAmount: number | null; // current amountOpen (null if deleted)
    currentStatus: string | null; // current status (null if deleted)
    /** Positive = more cash than expected. Negative = less cash than expected. */
    impact: number;
}

export interface DriverGroup {
    items: DriverItem[];
    total: number;  // sum of impact
    count: number;
}

export type ActualCashBasis = "adjusted_cash";

export interface VarianceDriverResult {
    checkpointId: string;
    companyId: string;
    weekStart: string;   // ISO date string
    weekEnd: string;     // ISO date string

    // Actual cash basis
    actualBankBalance: number;
    actualAdjustmentTotal: number;
    actualAdjustedCash: number;
    actualCashBasis: ActualCashBasis;

    // Forecast expected
    endCashExpected: number;

    // Variance = actualAdjustedCash - endCashExpected
    totalVariance: number;

    // AR drivers (inflow items)
    arCollected:     DriverGroup; // invoice paid — expected happened, $0 impact
    arNotCollected:  DriverGroup; // invoice still open — cash didn't arrive (negative impact)
    arModified:      DriverGroup; // invoice still open but amount changed
    arDeleted:       DriverGroup; // invoice no longer in DB

    // AP drivers (outflow items)
    apPaid:          DriverGroup; // bill paid — expected happened, $0 impact
    apNotPaid:       DriverGroup; // bill still open — cash was preserved (positive impact)
    apModified:      DriverGroup; // bill still open but amount changed
    apDeleted:       DriverGroup; // bill no longer in DB

    // Unverifiable (no ground-truth signal)
    unverifiableRecurring: DriverGroup; // RecurringPattern — no paid/cleared field
    unverifiableBaseline:  DriverGroup; // baseline assumption — no ground truth

    // Summary
    explainedVariance: number;     // sum of all AR/AP driver impacts
    unexplainedResidual: number;   // totalVariance - explainedVariance
    explanationCoverage: number;   // explainedVariance / totalVariance (0–1)

    warnings: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyGroup(): DriverGroup {
    return { items: [], total: 0, count: 0 };
}

function addToGroup(group: DriverGroup, item: DriverItem): void {
    group.items.push(item);
    group.total += item.impact;
    group.count += 1;
}

function parseBreakdown(raw: string | null): WeekBreakdown | null {
    if (!raw) return null;
    try {
        return JSON.parse(raw) as WeekBreakdown;
    } catch {
        return null;
    }
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Computes deterministic variance drivers for a ForecastCheckpoint.
 *
 * Actual cash = bankBalance + current CashAdjustment totals.
 *
 * NOTE (V1.1 limitation): Because ForecastCheckpoint V1 did not persist
 * cash adjustments at rollover time, the adjustment total reflects current DB
 * state. If adjustments are edited after rollover, totalVariance may drift
 * from the value at the exact moment of rollover. This is acceptable for V1.1.
 */
export async function computeVarianceDrivers(
    checkpointId: string,
    companyId: string
): Promise<VarianceDriverResult> {
    const warnings: string[] = [];

    // ── Query 1: Load ForecastCheckpoint (with tenant guard) ──────────────────
    const checkpoint = await prisma.forecastCheckpoint.findFirst({
        where: { id: checkpointId, companyId },
    });

    if (!checkpoint) {
        throw new Error(`ForecastCheckpoint not found: ${checkpointId}`);
    }

    // ── Query 2: Load linked CashSnapshot ────────────────────────────────────
    const snapshot = await prisma.cashSnapshot.findUnique({
        where: { id: checkpoint.cashSnapshotId },
        select: { bankBalance: true },
    });

    if (!snapshot) {
        throw new Error(`CashSnapshot not found for checkpoint ${checkpointId}`);
    }

    // ── Query 3: Load current CashAdjustments for this company ───────────────
    const adjustments = await prisma.cashAdjustment.findMany({
        where: { companyId },
        select: { amount: true },
    });

    const actualBankBalance = snapshot.bankBalance;
    const actualAdjustmentTotal = adjustments.reduce((sum, a) => sum + a.amount, 0);
    const actualAdjustedCash = actualBankBalance + actualAdjustmentTotal;
    const endCashExpected = checkpoint.endCashExpected;
    const totalVariance = actualAdjustedCash - endCashExpected;

    // ── Parse breakdownJson ───────────────────────────────────────────────────
    const breakdown = parseBreakdown(checkpoint.breakdownJson as string | null);

    if (!breakdown) {
        warnings.push("Breakdown data not available — checkpoint predates driver analysis.");
        return {
            checkpointId,
            companyId,
            weekStart: checkpoint.weekStart.toISOString(),
            weekEnd: checkpoint.weekEnd.toISOString(),
            actualBankBalance,
            actualAdjustmentTotal,
            actualAdjustedCash,
            actualCashBasis: "adjusted_cash",
            endCashExpected,
            totalVariance,
            arCollected:     emptyGroup(),
            arNotCollected:  emptyGroup(),
            arModified:      emptyGroup(),
            arDeleted:       emptyGroup(),
            apPaid:          emptyGroup(),
            apNotPaid:       emptyGroup(),
            apModified:      emptyGroup(),
            apDeleted:       emptyGroup(),
            unverifiableRecurring: emptyGroup(),
            unverifiableBaseline:  emptyGroup(),
            explainedVariance: 0,
            unexplainedResidual: totalVariance,
            explanationCoverage: 0,
            warnings,
        };
    }

    // ── Collect IDs to batch-query ────────────────────────────────────────────
    const visibility = await getManagerialVisibility(companyId);
    const invoiceIds = breakdown.inflows
        .filter(i => i.sourceType === "invoice" && i.sourceId)
        .map(i => i.sourceId as string);

    const billIds = breakdown.outflows
        .filter(o => o.sourceType === "bill" && o.sourceId)
        .map(o => o.sourceId as string);

    const visibleInvoiceIds = invoiceIds.filter(id => !visibility.hiddenInvoiceIds.has(id));
    const visibleBillIds = billIds.filter(id => !visibility.hiddenBillIds.has(id));

    // ── Query 4a: Batch load invoices ─────────────────────────────────────────
    const invoiceRows = visibleInvoiceIds.length > 0
        ? await prisma.receivableInvoice.findMany({
            where: { companyId, id: { in: visibleInvoiceIds } },
            select: { id: true, status: true, amountOpen: true },
        })
        : [];

    const invoiceMap = new Map(invoiceRows.map(r => [r.id, r]));

    // ── Query 4b: Batch load bills ────────────────────────────────────────────
    const billRows = visibleBillIds.length > 0
        ? await prisma.payableBill.findMany({
            where: { companyId, id: { in: visibleBillIds } },
            select: { id: true, status: true, amountOpen: true },
        })
        : [];

    const billMap = new Map(billRows.map(r => [r.id, r]));

    // ── Initialise driver groups ──────────────────────────────────────────────
    const arCollected     = emptyGroup();
    const arNotCollected  = emptyGroup();
    const arModified      = emptyGroup();
    const arDeleted       = emptyGroup();
    const apPaid          = emptyGroup();
    const apNotPaid       = emptyGroup();
    const apModified      = emptyGroup();
    const apDeleted       = emptyGroup();
    const unverifiableRecurring = emptyGroup();
    const unverifiableBaseline  = emptyGroup();

    let deletedInvoiceCount = 0;
    let deletedBillCount = 0;

    // ── Classify inflow items ─────────────────────────────────────────────────
    for (const item of breakdown.inflows) {
        if (item.sourceType === "invoice" && item.sourceId && visibility.hiddenInvoiceIds.has(item.sourceId)) continue;
        const base: Omit<DriverItem, "currentAmount" | "currentStatus" | "impact"> = {
            label: item.label,
            sourceType: item.sourceType,
            sourceId: item.sourceId ?? null,
            expectedAmount: item.amount,
        };

        if (item.sourceType === "invoice" && item.sourceId) {
            const row = invoiceMap.get(item.sourceId);

            if (!row) {
                // Deleted since checkpoint
                deletedInvoiceCount++;
                addToGroup(arDeleted, { ...base, currentAmount: null, currentStatus: null, impact: -item.amount });
            } else if (row.status === "paid" || row.status === "closed") {
                // Collected as expected
                addToGroup(arCollected, { ...base, currentAmount: row.amountOpen, currentStatus: row.status, impact: 0 });
            } else if (Math.abs(row.amountOpen - item.amount) < 0.01) {
                // Still open, amount unchanged — cash didn't arrive
                addToGroup(arNotCollected, { ...base, currentAmount: row.amountOpen, currentStatus: row.status, impact: -item.amount });
            } else {
                // Open but amount changed
                const impact = -(item.amount - row.amountOpen);
                addToGroup(arModified, { ...base, currentAmount: row.amountOpen, currentStatus: row.status, impact });
            }
        } else if (item.sourceType === "recurring") {
            addToGroup(unverifiableRecurring, { ...base, currentAmount: null, currentStatus: null, impact: 0 });
        } else if (item.sourceType === "baseline") {
            addToGroup(unverifiableBaseline, { ...base, currentAmount: null, currentStatus: null, impact: 0 });
        }
        // Other sourceTypes (assumption, customer, etc.) treated as unverifiable baseline
        else {
            addToGroup(unverifiableBaseline, { ...base, currentAmount: null, currentStatus: null, impact: 0 });
        }
    }

    // ── Classify outflow items ────────────────────────────────────────────────
    for (const item of breakdown.outflows) {
        if (item.sourceType === "bill" && item.sourceId && visibility.hiddenBillIds.has(item.sourceId)) continue;
        const base: Omit<DriverItem, "currentAmount" | "currentStatus" | "impact"> = {
            label: item.label,
            sourceType: item.sourceType,
            sourceId: item.sourceId ?? null,
            expectedAmount: item.amount,
        };

        if (item.sourceType === "bill" && item.sourceId) {
            const row = billMap.get(item.sourceId);

            if (!row) {
                // Deleted since checkpoint — expected cash out didn't leave
                deletedBillCount++;
                addToGroup(apDeleted, { ...base, currentAmount: null, currentStatus: null, impact: item.amount });
            } else if (row.status === "paid" || row.status === "closed") {
                // Paid as expected
                addToGroup(apPaid, { ...base, currentAmount: row.amountOpen, currentStatus: row.status, impact: 0 });
            } else if (Math.abs(row.amountOpen - item.amount) < 0.01) {
                // Still open, amount unchanged — cash was preserved
                addToGroup(apNotPaid, { ...base, currentAmount: row.amountOpen, currentStatus: row.status, impact: item.amount });
            } else {
                // Open but amount changed
                const impact = item.amount - row.amountOpen;
                addToGroup(apModified, { ...base, currentAmount: row.amountOpen, currentStatus: row.status, impact });
            }
        } else if (item.sourceType === "recurring") {
            addToGroup(unverifiableRecurring, { ...base, currentAmount: null, currentStatus: null, impact: 0 });
        } else if (item.sourceType === "baseline") {
            addToGroup(unverifiableBaseline, { ...base, currentAmount: null, currentStatus: null, impact: 0 });
        } else {
            addToGroup(unverifiableBaseline, { ...base, currentAmount: null, currentStatus: null, impact: 0 });
        }
    }

    // ── Warnings ──────────────────────────────────────────────────────────────
    if (deletedInvoiceCount > 0) {
        warnings.push(`${deletedInvoiceCount} invoice${deletedInvoiceCount !== 1 ? "s" : ""} removed since checkpoint.`);
    }
    if (deletedBillCount > 0) {
        warnings.push(`${deletedBillCount} bill${deletedBillCount !== 1 ? "s" : ""} removed since checkpoint.`);
    }

    // ── Summary math ──────────────────────────────────────────────────────────
    const explainedVariance =
        arCollected.total + arNotCollected.total + arModified.total + arDeleted.total +
        apPaid.total + apNotPaid.total + apModified.total + apDeleted.total;

    const unexplainedResidual = totalVariance - explainedVariance;
    const explanationCoverage = totalVariance !== 0
        ? Math.min(1, Math.abs(explainedVariance) / Math.abs(totalVariance))
        : 1;

    return {
        checkpointId,
        companyId,
        weekStart: checkpoint.weekStart.toISOString(),
        weekEnd: checkpoint.weekEnd.toISOString(),
        actualBankBalance,
        actualAdjustmentTotal,
        actualAdjustedCash,
        actualCashBasis: "adjusted_cash",
        endCashExpected,
        totalVariance,
        arCollected,
        arNotCollected,
        arModified,
        arDeleted,
        apPaid,
        apNotPaid,
        apModified,
        apDeleted,
        unverifiableRecurring,
        unverifiableBaseline,
        explainedVariance,
        unexplainedResidual,
        explanationCoverage,
        warnings,
    };
}
