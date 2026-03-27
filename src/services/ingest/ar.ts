// services/ingest/ar.ts
// AR-specific: field definitions, auto-detect, normalize rows, preview summary.
// Imports pure functions from columnMapper so both code paths share one definition.

import {
    AR_FIELDS,
    autoDetect,
    applyARMapping,
    arSummary,
    type NormalizedARRow,
} from "@/services/columnMapper";

export type { NormalizedARRow };

export interface ARPrepareResult {
    mapping: Record<string, string>;
    savedMappingUsed: boolean;
}

/**
 * Return the best column mapping for an AR file.
 * If a saved mapping is provided and covers all required fields, use it.
 * Otherwise fall back to auto-detection from headers.
 */
export function prepareAR(
    headers: string[],
    savedMapping: Record<string, string> | null
): ARPrepareResult {
    if (savedMapping && coversRequired(savedMapping, ["customerName", "invoiceNo", "amountOpen"])) {
        return { mapping: savedMapping, savedMappingUsed: true };
    }
    const mapping = autoDetect(headers, AR_FIELDS);
    return { mapping, savedMappingUsed: false };
}

/**
 * Apply a mapping to raw rows, returning normalized AR rows.
 * Filters rows that lack required fields (customerName, invoiceNo).
 */
export function normalizeARRows(
    rows: Record<string, string>[],
    mapping: Record<string, string>
): NormalizedARRow[] {
    return applyARMapping(rows, mapping);
}

/**
 * Return the first N normalized rows for preview, plus summary stats.
 */
export function arPreview(rows: NormalizedARRow[], n = 10) {
    return {
        preview: rows.slice(0, n),
        summary: arSummary(rows),
    };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function coversRequired(mapping: Record<string, string>, keys: string[]): boolean {
    return keys.every(k => !!mapping[k]);
}

// Re-export field definitions so API routes can reference them
export { AR_FIELDS };
