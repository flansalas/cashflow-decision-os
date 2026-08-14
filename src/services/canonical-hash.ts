import { createHash } from 'crypto';

export const HASH_ALGORITHM = 'sha256-canonical-json-v1';
export const FORECAST_SCHEMA_VERSION = 1;

/**
 * Deterministic JSON canonicalization.
 * - Object keys sorted recursively in lexicographic order
 * - Arrays preserved in their provided order (caller must pre-sort)
 * - undefined values omitted
 * - null preserved
 * - NaN/Infinity replaced with null
 * - No persistence-generated IDs in content identity
 */
export function canonicalJsonSerialize(value: any): string {
    return JSON.stringify(value, canonicalReplacer);
}

function canonicalReplacer(_key: string, value: any): any {
    if (value === undefined) return undefined; // omitted by JSON.stringify
    if (typeof value === 'number') {
        if (!isFinite(value)) return null;
        return value;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        const sorted: Record<string, any> = {};
        const keys = Object.keys(value).sort();
        for (const k of keys) {
            if (value[k] !== undefined) {
                sorted[k] = value[k];
            }
        }
        return sorted;
    }
    return value;
}

/**
 * Compute SHA-256 hash of canonical JSON string.
 */
export function computeCanonicalHash(canonicalJson: string): string {
    return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

/**
 * Convert a dollar amount to integer cents for deterministic hashing.
 */
export function toCents(dollars: number): number {
    return Math.round(dollars * 100);
}

/**
 * Normalize a date to UTC ISO string for deterministic hashing.
 */
export function toUTCISO(date: Date | string | null | undefined): string | null {
    if (!date) return null;
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString();
}

/**
 * Build the source-state JSON for a component and compute its hash.
 */
export function buildSourceStateHash(sourceStateJson: string): string {
    return createHash('sha256').update(sourceStateJson, 'utf8').digest('hex');
}

/**
 * Sort components deterministically for canonical payload.
 */
export function sortComponentsForCanonical(components: any[]): any[] {
    return [...components].sort((a, b) => {
        return (
            (a.direction || '').localeCompare(b.direction || '') ||
            (a.sourceType || '').localeCompare(b.sourceType || '') ||
            (a.sourceId || '').localeCompare(b.sourceId || '') ||
            (a.targetWeekStart || '').localeCompare(b.targetWeekStart || '') ||
            (a.componentCategory || '').localeCompare(b.componentCategory || '') ||
            (a.label || '').localeCompare(b.label || '') ||
            (a.sourceStateHash || '').localeCompare(b.sourceStateHash || '')
        );
    });
}

export interface CanonicalPayload {
    schemaVersion: number;
    companyId: string;
    cashSnapshotBalanceCents: number;
    cashSnapshotAsOfDate: string;
    adjustedOpeningCashCents: number;
    assumptions: any;
    baselineReference: any;
    forecastAssemblyVersion: string;
    forecastEngineVersion: string;
    appCommitHash: string | null;
    weeks: any[];
    components: any[];
}

/**
 * Build the canonical payload object from forecast assembly data.
 * generatedAt and sealedAt are intentionally EXCLUDED from content identity.
 */
export function buildCanonicalPayload(opts: {
    companyId: string;
    cashSnapshotBalance: number;
    cashSnapshotAsOfDate: Date;
    adjustedOpeningCash: number;
    assumptions: any;
    baselineReference: any;
    forecastWeeks: any[];
    components: any[];
    appCommitHash: string | null;
}): CanonicalPayload {
    return {
        schemaVersion: FORECAST_SCHEMA_VERSION,
        companyId: opts.companyId,
        cashSnapshotBalanceCents: toCents(opts.cashSnapshotBalance),
        cashSnapshotAsOfDate: opts.cashSnapshotAsOfDate.toISOString(),
        adjustedOpeningCashCents: toCents(opts.adjustedOpeningCash),
        assumptions: {
            bufferMin: opts.assumptions?.bufferMin ?? null,
            fixedWeeklyOutflow: opts.assumptions?.fixedWeeklyOutflow ?? null,
            payrollCadence: opts.assumptions?.payrollCadence ?? null,
            payrollAllInAmount: opts.assumptions?.payrollAllInAmount ?? null,
            payrollNextDate: toUTCISO(opts.assumptions?.payrollNextDate),
            rentMonthlyAmount: opts.assumptions?.rentMonthlyAmount ?? null,
            rentDayOfMonth: opts.assumptions?.rentDayOfMonth ?? null,
            paymentCurveJson: opts.assumptions?.paymentCurveJson ?? null,
            highRiskAgingDays: opts.assumptions?.highRiskAgingDays ?? null,
            projectionSafetyMargin: opts.assumptions?.projectionSafetyMargin ?? null
        },
        baselineReference: {
            hasBankBaseline: opts.baselineReference?.hasBankBaseline ?? null,
            confidence: opts.baselineReference?.confidence ?? null,
            baselineSourceStateHash: opts.baselineReference?.baselineSourceStateHash ?? null,
            baselineSemanticVersion: opts.baselineReference?.baselineSemanticVersion ?? null
        },
        forecastAssemblyVersion: 'assembly-v1',
        forecastEngineVersion: 'forecast-v1',
        appCommitHash: opts.appCommitHash,
        weeks: opts.forecastWeeks.map(w => ({
            weekNumber: w.weekNumber,
            weekStart: toUTCISO(w.weekStart),
            weekEnd: toUTCISO(w.weekEnd),
            startCashCents: toCents(w.startCash),
            inflowsExpectedCents: toCents(w.inflowsExpected),
            outflowsExpectedCents: toCents(w.outflowsExpected),
            endCashExpectedCents: toCents(w.endCashExpected),
            inflowsBestCents: toCents(w.inflowsBest),
            outflowsBestCents: toCents(w.outflowsBest),
            endCashBestCents: toCents(w.endCashBest),
            inflowsWorstCents: toCents(w.inflowsWorst),
            outflowsWorstCents: toCents(w.outflowsWorst),
            endCashWorstCents: toCents(w.endCashWorst),
            zone: w.zone,
            confidenceScore: w.confidenceScore,
        })),
        components: sortComponentsForCanonical(opts.components),
    };
}
