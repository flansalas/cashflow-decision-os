// services/ingest/ap.ts
// AP-specific: field definitions, auto-detect, normalize rows, preview summary.

import {
    AP_FIELDS,
    autoDetect,
    applyAPMapping,
    apSummary,
    type NormalizedAPRow,
} from "@/services/columnMapper";

export type { NormalizedAPRow };

export interface APPrepareResult {
    mapping: Record<string, string>;
    savedMappingUsed: boolean;
}

/**
 * Return the best column mapping for an AP file.
 */
export function prepareAP(
    headers: string[],
    savedMapping: Record<string, string> | null
): APPrepareResult {
    if (savedMapping && coversRequired(savedMapping, ["vendorName", "billNo", "amountOpen"])) {
        return { mapping: savedMapping, savedMappingUsed: true };
    }
    const mapping = autoDetect(headers, AP_FIELDS);
    return { mapping, savedMappingUsed: false };
}

/**
 * Apply a mapping to raw rows, returning normalized AP rows.
 */
export function normalizeAPRows(
    rows: Record<string, string>[],
    mapping: Record<string, string>
): NormalizedAPRow[] {
    return applyAPMapping(rows, mapping);
}

/**
 * Return the first N normalized rows for preview, plus summary stats.
 */
export function apPreview(rows: NormalizedAPRow[], n = 10) {
    return {
        preview: rows.slice(0, n),
        summary: apSummary(rows),
    };
}

function coversRequired(mapping: Record<string, string>, keys: string[]): boolean {
    return keys.every(k => !!mapping[k]);
}

export { AP_FIELDS };
