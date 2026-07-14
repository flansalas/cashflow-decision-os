/**
 * Payment Behavior Memory Service
 *
 * Records durable, append-only observations of verified customer and vendor payments.
 * Derives behavioral statistics from observed history only.
 *
 * Rules:
 * - An observation is only written when payment is VERIFIED from an authoritative source.
 * - A manually-moved expected date is NOT an actual payment — never write an observation for it.
 * - Observations are never overwritten. Historical evidence is immutable.
 * - Duplicate observations for the same invoice/payment date are prevented by unique constraint.
 * - Statistics are derived at query time from the observation log (no persisted aggregates needed).
 */

import prisma from "@/db/prisma";

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────

export type PaymentObservationSource = "ar_import" | "bank_match" | "manual_verified" | "manual_confirmed_date";
export type VendorObservationSource = "ap_import" | "bank_match" | "manual_verified" | "manual_confirmed_date";

export interface CustomerPaymentStats {
    customerName: string;
    observationCount: number;
    avgDaysLate: number;
    medianDaysLate: number;
    onTimePct: number;         // % of payments on or before due date
    recentTrend: "improving" | "worsening" | "stable" | "insufficient_data";
    confidence: "high" | "medium" | "low" | "none";
    lastObservedAt: Date | null;
}

export interface VendorPaymentStats {
    vendorName: string;
    observationCount: number;
    avgDaysEarlyOrLate: number;
    medianDaysEarlyOrLate: number;
    onTimeOrEarlyPct: number;  // % of payments on or before due date
    recentTrend: "improving" | "worsening" | "stable" | "insufficient_data";
    confidence: "high" | "medium" | "low" | "none";
    lastObservedAt: Date | null;
}

// ────────────────────────────────────────────────
// Customer Payment Observation
// ────────────────────────────────────────────────

export interface RecordCustomerPaymentParams {
    companyId: string;
    customerName: string;
    invoiceId: string;
    invoiceNo?: string | null;
    dueDate: Date | null;
    expectedPaymentDate?: Date | null;
    actualPaymentDate: Date;
    amount: number;
    paymentSource: PaymentObservationSource;
}

/**
 * Record a verified customer payment observation.
 * The unique constraint (companyId, invoiceId, actualPaymentDate) prevents duplicates.
 * Returns the created record, or null if it was a duplicate (silently skipped).
 */
export async function recordCustomerPaymentObservation(
    params: RecordCustomerPaymentParams
): Promise<{ id: string } | null> {
    const daysEarlyOrLate = params.dueDate
        ? Math.round(
            (params.actualPaymentDate.getTime() - params.dueDate.getTime()) / (1000 * 60 * 60 * 24)
          )
        : 0;

    try {
        const obs = await prisma.customerPaymentObservation.create({
            data: {
                companyId: params.companyId,
                customerName: params.customerName,
                invoiceId: params.invoiceId,
                invoiceNo: params.invoiceNo ?? null,
                dueDate: params.dueDate,
                expectedPaymentDate: params.expectedPaymentDate ?? null,
                actualPaymentDate: params.actualPaymentDate,
                daysEarlyOrLate,
                amount: params.amount,
                paymentSource: params.paymentSource,
            },
        });
        return { id: obs.id };
    } catch (e: any) {
        // P2002 = unique constraint violation: duplicate observation, silently skip
        if (e?.code === "P2002") {
            return null;
        }
        throw e;
    }
}

/**
 * Derive customer payment statistics from all recorded observations.
 * Returns null if no observations exist for the customer.
 */
export async function getCustomerPaymentStats(
    companyId: string,
    customerName: string
): Promise<CustomerPaymentStats | null> {
    const observations = await prisma.customerPaymentObservation.findMany({
        where: { companyId, customerName },
        orderBy: { observedAt: "asc" },
    });

    if (observations.length === 0) return null;

    const days = observations.map(o => o.daysEarlyOrLate);
    const avgDaysLate = days.reduce((a, b) => a + b, 0) / days.length;
    const medianDaysLate = median(days);
    const onTimePct = (days.filter(d => d <= 0).length / days.length) * 100;
    const confidence = deriveConfidence(observations.length);
    const recentTrend = deriveCustomerTrend(days);
    const lastObservedAt = observations[observations.length - 1]?.observedAt ?? null;

    return {
        customerName,
        observationCount: observations.length,
        avgDaysLate,
        medianDaysLate,
        onTimePct,
        recentTrend,
        confidence,
        lastObservedAt,
    };
}

/**
 * Compute the typical payment delay in weeks from observation data.
 * Returns null if fewer than 2 observations (not enough signal).
 * Uses median days late (more robust than mean for lumpy payers).
 */
export function computeTypicalDelayWeeks(
    observations: Array<{ daysEarlyOrLate: number }>
): number | null {
    if (observations.length < 2) return null;
    const days = observations.map(o => o.daysEarlyOrLate);
    const med = median(days);
    // Floor at 0: if they pay early on average, don't shift the date backward
    return Math.max(0, Math.round(med / 7));
}

// ────────────────────────────────────────────────
// Vendor Payment Observation
// ────────────────────────────────────────────────

export interface RecordVendorPaymentParams {
    companyId: string;
    vendorName: string;
    billId: string;
    billNo?: string | null;
    dueDate: Date | null;
    plannedPaymentDate?: Date | null;
    actualPaymentDate: Date;
    amount: number;
    paymentSource: VendorObservationSource;
}

/**
 * Record a verified vendor payment observation.
 * The unique constraint (companyId, billId, actualPaymentDate) prevents duplicates.
 */
export async function recordVendorPaymentObservation(
    params: RecordVendorPaymentParams
): Promise<{ id: string } | null> {
    const daysEarlyOrLate = params.dueDate
        ? Math.round(
            (params.actualPaymentDate.getTime() - params.dueDate.getTime()) / (1000 * 60 * 60 * 24)
          )
        : 0;

    try {
        const obs = await prisma.vendorPaymentObservation.create({
            data: {
                companyId: params.companyId,
                vendorName: params.vendorName,
                billId: params.billId,
                billNo: params.billNo ?? null,
                dueDate: params.dueDate,
                plannedPaymentDate: params.plannedPaymentDate ?? null,
                actualPaymentDate: params.actualPaymentDate,
                daysEarlyOrLate,
                amount: params.amount,
                paymentSource: params.paymentSource,
            },
        });
        return { id: obs.id };
    } catch (e: any) {
        if (e?.code === "P2002") {
            return null;
        }
        throw e;
    }
}

/**
 * Derive vendor payment statistics from all recorded observations.
 */
export async function getVendorPaymentStats(
    companyId: string,
    vendorName: string
): Promise<VendorPaymentStats | null> {
    const observations = await prisma.vendorPaymentObservation.findMany({
        where: { companyId, vendorName },
        orderBy: { observedAt: "asc" },
    });

    if (observations.length === 0) return null;

    const days = observations.map(o => o.daysEarlyOrLate);
    const avgDaysEarlyOrLate = days.reduce((a, b) => a + b, 0) / days.length;
    const medianDaysEarlyOrLate = median(days);
    const onTimeOrEarlyPct = (days.filter(d => d <= 0).length / days.length) * 100;
    const confidence = deriveConfidence(observations.length);
    const recentTrend = deriveVendorTrend(days);
    const lastObservedAt = observations[observations.length - 1]?.observedAt ?? null;

    return {
        vendorName,
        observationCount: observations.length,
        avgDaysEarlyOrLate,
        medianDaysEarlyOrLate,
        onTimeOrEarlyPct,
        recentTrend,
        confidence,
        lastObservedAt,
    };
}

// ────────────────────────────────────────────────
// Import Batch Tracking
// ────────────────────────────────────────────────

export interface CreateImportBatchParams {
    companyId: string;
    importType: "ar" | "ap" | "bank";
    filename: string;
    uploadedBy?: string | null;
    rowCount: number;
    acceptedCount: number;
    rejectedCount?: number;
    duplicateCount?: number;
    status: "success" | "partial" | "failed";
    sourceDateStart?: Date | null;
    sourceDateEnd?: Date | null;
    fileHash?: string | null;
    mappingProfileId?: string | null;
    errorSummary?: string | null;
}

export async function createImportBatch(params: CreateImportBatchParams): Promise<{ id: string }> {
    const batch = await prisma.importBatch.create({
        data: {
            companyId: params.companyId,
            importType: params.importType,
            filename: params.filename,
            uploadedBy: params.uploadedBy ?? null,
            rowCount: params.rowCount,
            acceptedCount: params.acceptedCount,
            rejectedCount: params.rejectedCount ?? (params.rowCount - params.acceptedCount),
            duplicateCount: params.duplicateCount ?? 0,
            status: params.status,
            sourceDateStart: params.sourceDateStart ?? null,
            sourceDateEnd: params.sourceDateEnd ?? null,
            fileHash: params.fileHash ?? null,
            mappingProfileId: params.mappingProfileId ?? null,
            errorSummary: params.errorSummary ?? null,
        },
    });
    return { id: batch.id };
}

// ────────────────────────────────────────────────
// Statistical helpers (pure functions)
// ────────────────────────────────────────────────

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Confidence tiers based on observation sample size.
 * Fewer than 3 observations = none.
 * 3–5 = low. 6–12 = medium. 13+ = high.
 */
function deriveConfidence(n: number): "high" | "medium" | "low" | "none" {
    if (n < 3) return "none";
    if (n < 6) return "low";
    if (n < 13) return "medium";
    return "high";
}

/**
 * Derive trend from the last 4 observations vs. the 4 before that.
 * Uses median to avoid single-outlier domination.
 * Returns "insufficient_data" when fewer than 4 observations.
 */
function deriveCustomerTrend(days: number[]): CustomerPaymentStats["recentTrend"] {
    if (days.length < 4) return "insufficient_data";
    const recent = days.slice(-4);
    const prior = days.slice(-8, -4);
    if (prior.length === 0) return "insufficient_data";
    const recentMedian = median(recent);
    const priorMedian = median(prior);
    const delta = recentMedian - priorMedian;
    // Negative delta = paying earlier (improving for the customer's creditor)
    if (delta < -3) return "improving";
    if (delta > 3) return "worsening";
    return "stable";
}

function deriveVendorTrend(days: number[]): VendorPaymentStats["recentTrend"] {
    if (days.length < 4) return "insufficient_data";
    const recent = days.slice(-4);
    const prior = days.slice(-8, -4);
    if (prior.length === 0) return "insufficient_data";
    const recentMedian = median(recent);
    const priorMedian = median(prior);
    const delta = recentMedian - priorMedian;
    // Negative delta = paying earlier = improving vendor management
    if (delta < -3) return "improving";
    if (delta > 3) return "worsening";
    return "stable";
}
