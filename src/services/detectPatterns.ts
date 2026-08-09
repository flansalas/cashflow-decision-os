// services/detectPatterns.ts – Detect recurring outflow patterns from bank transactions
// Pure logic. No React, no DB imports.

export interface BankTxForDetection {
    txDate: Date;
    amount: number;        // always positive (absolute value)
    description: string;
    direction: "inflow" | "outflow";
}

export interface DetectedPattern {
    merchantKey: string;        // normalized key used for grouping
    displayName: string;        // human-readable name for UI
    cadence: "weekly" | "biweekly" | "monthly" | "irregular";
    typicalAmount: number;      // mean absolute amount
    amountStdDev: number;
    confidence: "high" | "med" | "low";
    occurrences: number;        // how many times seen
    firstSeen: Date;
    lastSeen: Date;
    nextExpectedDate: Date;     // projected next occurrence
    category: string;           // auto-categorized
}

// ─── Normalization ───────────────────────────────────────────────────────────

// Strip common bank noise from descriptions to get a consistent merchant key
export function normalizeDescription(raw: string): string {
    let s = raw.trim().toUpperCase();

    // Remove leading/trailing transaction IDs like "POS #3948", ref numbers, etc.
    // Remove trailing sequences of digits (transaction IDs)
    s = s.replace(/\s+\d{4,}\s*$/, "");

    // Remove common bank prefixes
    s = s.replace(/^(POS |ACH |CHECK |DEBIT |WIRE |XFER |EFT |CCD |CHECKCARD |DDA |WEB )+/i, "");

    // Remove common suffixes like state abbreviations " FL", " TX", " CA"
    s = s.replace(/\s+[A-Z]{2}\s*$/, "");

    // Remove date patterns embedded in description (MM/DD, MMDD)
    s = s.replace(/\b\d{1,2}\/\d{1,2}\b/g, "");
    s = s.replace(/\b\d{4}\b/g, ""); // 4-digit years or transaction IDs

    // Collapse multiple spaces
    s = s.replace(/\s{2,}/g, " ").trim();

    // Lowercase for consistent grouping
    return s.toLowerCase();
}

// Auto-categorize based on merchant keywords
export function categorize(displayName: string): string {
    const name = displayName.toLowerCase();
    if (/payroll|adp|paychex|gusto|rippling|bamboo|paylocity|quickbooks pay|intuit pay/.test(name)) return "payroll";
    if (/rent|lease|property|realty|landlord/.test(name)) return "rent";
    if (/loan|mortgage|lender|financing|credit union|sba|bank payment|note pay/.test(name)) return "loan";
    if (/amazon|google|apple|microsoft|adobe|dropbox|slack|zoom|hubspot|salesforce|quickbooks|intuit|godaddy|shopify|twilio|stripe/.test(name)) return "subscription";
    if (/electric|water|gas|utility|utilities|power|energy|duke|pge|fpl|xcel/.test(name)) return "utilities";
    if (/fuel|gas station|shell|bp |exxon|chevron|pilot|loves|wawa|speedway|circle k|petro/.test(name)) return "fuel";
    if (/insurance|ins |allstate|geico|state farm|progressive|nationwide/.test(name)) return "other";
    if (/tax|irs|state revenue|dept of revenue|revenue dept/.test(name)) return "taxes";
    if (/visa|mastercard|amex|american express|discover|capital one|citibank|chase sapphire/.test(name)) return "card_payment";
    if (/supplies|material|home depot|lowes|grainger|mcmaster|fastenal|uline/.test(name)) return "materials";
    return "other";
}

// ─── Interval Analysis ───────────────────────────────────────────────────────

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function detectCadence(intervalDays: number[]): "weekly" | "biweekly" | "monthly" | "irregular" {
    if (intervalDays.length === 0) return "irregular";
    const med = median(intervalDays);
    if (med >= 5 && med <= 9) return "weekly";
    if (med >= 10 && med <= 18) return "biweekly";
    if (med >= 25 && med <= 35) return "monthly";
    return "irregular";
}

function cadenceIntervalDays(cadence: "weekly" | "biweekly" | "monthly" | "irregular"): number {
    if (cadence === "weekly") return 7;
    if (cadence === "biweekly") return 14;
    if (cadence === "monthly") return 30;
    return 30; // fallback for irregular
}

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
}

function stddev(values: number[]): number {
    if (values.length < 2) return 0;
    const m = mean(values);
    const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}

function addDays(d: Date, n: number): Date {
    const dt = new Date(d);
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt;
}

// ─── Main Detection ──────────────────────────────────────────────────────────

export const MIN_OCCURRENCES = 2;
export const MIN_AMOUNT = 25;         // ignore tiny noise transactions
export const MAX_SUGGESTIONS = 20;   // cap suggestions shown to user

export function detectPatterns(
    txs: BankTxForDetection[],
    asOfDate: Date,
    existingMerchantKeys: Set<string> = new Set(),
): DetectedPattern[] {
    // Only analyze outflows
    const outflows = txs.filter(tx => tx.direction === "outflow" && tx.amount >= MIN_AMOUNT);

    // Group by normalized merchant key
    const groups = new Map<string, { raw: string; dates: Date[]; amounts: number[] }>();

    for (const tx of outflows) {
        const key = normalizeDescription(tx.description);
        if (!key || key.length < 3) continue; // skip empty / very short keys

        if (!groups.has(key)) {
            groups.set(key, { raw: tx.description, dates: [], amounts: [] });
        }
        const g = groups.get(key)!;
        g.dates.push(new Date(tx.txDate));
        g.amounts.push(tx.amount);
    }

    const suggestions: DetectedPattern[] = [];

    for (const [key, data] of groups) {
        if (data.dates.length < MIN_OCCURRENCES) continue;

        // We no longer skip existing patterns here.
        // The API route will cross-reference with DB to determine if it's a NEW vs UPDATE suggestion.
        // if (existingMerchantKeys.has(key)) continue;

        // Sort dates ascending
        data.dates.sort((a, b) => a.getTime() - b.getTime());

        // Compute intervals
        const intervals: number[] = [];
        for (let i = 1; i < data.dates.length; i++) {
            const daysDiff = Math.round(
                (data.dates[i].getTime() - data.dates[i - 1].getTime()) / 86_400_000
            );
            intervals.push(daysDiff);
        }

        const cadence = detectCadence(intervals);

        // Compute amount stats
        const typicalAmount = mean(data.amounts);
        const amtStdDev = stddev(data.amounts);
        const cvRatio = typicalAmount > 0 ? amtStdDev / typicalAmount : 1;

        // Interval consistency score
        const intervalMed = median(intervals);
        const intervalVariance = intervals.map(i => Math.abs(i - intervalMed));
        const avgIntervalDeviation = mean(intervalVariance);

        // Confidence scoring
        let confidence: "high" | "med" | "low";
        if (cvRatio < 0.08 && avgIntervalDeviation <= 3 && data.dates.length >= 3) {
            confidence = "high";
        } else if (cvRatio < 0.25 && avgIntervalDeviation <= 7) {
            confidence = "med";
        } else {
            confidence = "low";
        }

        // Don't bother suggesting irregular+low confidence items — too noisy
        if (cadence === "irregular" && confidence === "low") continue;

        // Compute next expected date by projecting forward from last seen
        const intervalForCadence = cadenceIntervalDays(cadence);
        let nextExpectedDate = addDays(data.dates[data.dates.length - 1], intervalForCadence);
        // Roll forward until it's in the future
        while (nextExpectedDate < asOfDate) {
            nextExpectedDate = addDays(nextExpectedDate, intervalForCadence);
        }

        // Build a clean display name from the raw description
        // Take first 40 chars of the original (not the fully-lowercased version)
        const displayName = data.raw
            .replace(/\s{2,}/g, " ")
            .trim()
            .slice(0, 50);

        suggestions.push({
            merchantKey: key,
            displayName,
            cadence,
            typicalAmount: Math.round(typicalAmount * 100) / 100,
            amountStdDev: Math.round(amtStdDev * 100) / 100,
            confidence,
            occurrences: data.dates.length,
            firstSeen: data.dates[0],
            lastSeen: data.dates[data.dates.length - 1],
            nextExpectedDate,
            category: categorize(displayName),
        });
    }

    // Sort: high confidence first, then by amount descending
    const confidenceOrder = { high: 0, med: 1, low: 2 };
    suggestions.sort((a, b) => {
        if (confidenceOrder[a.confidence] !== confidenceOrder[b.confidence]) {
            return confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
        }
        return b.typicalAmount - a.typicalAmount;
    });

    return suggestions.slice(0, MAX_SUGGESTIONS);
}

export interface RecurringMatchCandidate {
    merchantKey: string;
    displayName: string;
    direction: string;
    typicalAmount: number;
    amountStdDev: number;
    cadence?: string;
    nextExpectedDate?: Date | null;
}

export function isRecurringIdentityMatch(
    tx: { description: string; direction: string; amount: number; txDate: Date },
    pattern: RecurringMatchCandidate,
    lastMatchedDate: Date | null,
    cadence?: string
): boolean {
    if (tx.direction !== pattern.direction) return false;

    // Reject generic words as identity
    const genericWords = ["payment", "loan", "insurance", "subscription", "transfer", "deposit", "withdrawal", "fee", "ach", "wire", "check", "credit", "debit"];
    const txNorm = normalizeDescription(tx.description);
    const patKeyNorm = normalizeDescription(pattern.merchantKey);

    // Strict Identity match
    let isIdentityMatch = false;
    
    // Explicit merchant key match (if the key isn't just a generic word)
    if (patKeyNorm.length > 2 && !genericWords.includes(patKeyNorm)) {
        // Use exact match or contains
        if (txNorm.includes(patKeyNorm) || patKeyNorm.includes(txNorm)) {
            isIdentityMatch = true;
        }
    }

    if (!isIdentityMatch) return false;

    // Must also be within reasonable amount bounds (+/- 50% or 2 stddev)
    const absAmount = Math.abs(tx.amount);
    const minAmount = pattern.typicalAmount - Math.max(pattern.typicalAmount * 0.5, pattern.amountStdDev * 2);
    const maxAmount = pattern.typicalAmount + Math.max(pattern.typicalAmount * 0.5, pattern.amountStdDev * 2);

    if (absAmount < minAmount || absAmount > maxAmount) return false;
    
    // Enforce cadence / timing check if available
    const cadenceStr = cadence || pattern.cadence;
    
    // 1. Cadence Cooldown Check
    if (lastMatchedDate && cadenceStr) {
        const daysSince = Math.abs(Math.round((tx.txDate.getTime() - lastMatchedDate.getTime()) / 86400000));
        const cooldown = cadenceStr === "weekly" ? 5 : cadenceStr === "biweekly" ? 12 : 26;
        if (daysSince < cooldown) return false; // Too soon since last match
    }

    // 2. Expected Date Window Check
    if (pattern.nextExpectedDate) {
        const daysDiff = Math.round((tx.txDate.getTime() - pattern.nextExpectedDate.getTime()) / 86400000);
        // Allow a window around the expected date
        const windowDays = cadenceStr === "weekly" ? 3 : cadenceStr === "biweekly" ? 5 : 7;
        if (Math.abs(daysDiff) > windowDays) {
            return false; // Transaction falls outside the expected cadence window
        }
    }

    return true;
}

// ─── Semantic Duplicate Classification ──────────────────────────────────────
// Used by /api/upload/bank/detect and /api/upload/bank/patterns to classify
// detected patterns into four economic-identity buckets.

/** Low-information words excluded from token overlap scoring */
const NOISE_TOKENS = new Set([
    "the","a","an","and","or","of","for","in","on","at","to","by","from","with",
    "is","are","was","were","be","been","being","have","has","had","do","does",
    "did","will","would","could","should","may","might","can","llc","inc","corp",
    "co","ltd","payment","loan","debit","credit","ach","ref","transfer","funds",
    "dep","misc","preauthorized","auto","authorized",
]);

/** Extract meaningful tokens from a string for overlap scoring */
export function significantTokens(s: string): Set<string> {
    return new Set(
        s.toLowerCase()
            .replace(/[^a-z0-9\s]/g, " ")
            .split(/\s+/)
            .filter(t => t.length >= 3 && !NOISE_TOKENS.has(t))
    );
}

/** Jaccard-like overlap ratio on meaningful tokens (0–1).
 *  Uses min-set denominator: a subset scores 1.0 against its superset. */
export function tokenOverlapRatio(a: string, b: string): number {
    const tokA = significantTokens(a);
    const tokB = significantTokens(b);
    if (tokA.size === 0 || tokB.size === 0) return 0;
    let common = 0;
    for (const t of tokA) if (tokB.has(t)) common++;
    return common / Math.min(tokA.size, tokB.size);
}

export type PatternClassification =
    | "already_represented"  // Exact key match, amount & cadence stable — do NOT create
    | "update"               // Exact key match but drifted — offer update to existing
    | "ambiguous_overlap"    // No exact match but semantic signals strongly suggest overlap — do NOT default-select
    | "genuinely_new";       // No evidence of existing economic representation — may be created

export interface ClassificationResult {
    classification: PatternClassification;
    matchedPatternId?: string;        // id of the matching existing pattern (for updates)
    matchedPatternDisplayName?: string;
    updateReason?: string;            // human-readable reason for "update"
    overlapCandidates?: Array<{       // all semantic overlap candidates (for "ambiguous_overlap")
        id: string;
        displayName: string;
        typicalAmount: number;
        cadence: string;
        tokenOverlap: number;
        amountDiff: number;
    }>;
}

/**
 * Classify a detected pattern against the company's existing RecurringPatterns.
 *
 * Decision hierarchy:
 *  1. Exact normalized merchantKey match → already_represented or update
 *  2. Semantic overlap (token similarity ≥ 0.4 AND amount within 20% AND same direction
 *     AND compatible cadence) → ambiguous_overlap
 *  3. No match → genuinely_new
 *
 * Never uses amount alone. Never auto-creates for ambiguous_overlap.
 */
export function classifyDetectedPattern(
    detected: {
        merchantKey: string;
        displayName: string;
        typicalAmount: number;
        cadence: string;
        direction?: string;
    },
    existingPatterns: Array<{
        id: string;
        merchantKey: string;
        displayName: string;
        typicalAmount: number;
        cadence: string;
        direction: string;
        category?: string;
        isIncluded?: boolean;
    }>,
    options: {
        /** Minimum token overlap ratio to flag ambiguous overlap (default 0.4) */
        tokenOverlapThreshold?: number;
        /** Maximum relative amount difference to flag ambiguous overlap (default 0.20 = 20%) */
        amountToleranceRatio?: number;
        /** Amount drift threshold to classify exact-match as "update" (default 0.05 = 5%) */
        updateDriftThreshold?: number;
    } = {}
): ClassificationResult {
    const {
        tokenOverlapThreshold = 0.4,
        amountToleranceRatio = 0.20,
        updateDriftThreshold = 0.05,
    } = options;

    const detectedKeyNorm = detected.merchantKey.toLowerCase().trim();
    const detectedDir = (detected.direction ?? "outflow").toLowerCase();

    // ── Step 1: Exact merchantKey match ────────────────────────────────────
    const exactMatch = existingPatterns.find(
        p => p.merchantKey.toLowerCase().trim() === detectedKeyNorm
    );

    if (exactMatch) {
        const amountDrift = exactMatch.typicalAmount > 0
            ? Math.abs(detected.typicalAmount - exactMatch.typicalAmount) / exactMatch.typicalAmount
            : 1;
        const cadenceChanged = detected.cadence !== exactMatch.cadence;

        if (amountDrift > updateDriftThreshold || cadenceChanged) {
            const reasons: string[] = [];
            if (amountDrift > updateDriftThreshold) {
                reasons.push(
                    `amount drifted ${(amountDrift * 100).toFixed(1)}%: ` +
                    `was $${exactMatch.typicalAmount.toFixed(2)}, now $${detected.typicalAmount.toFixed(2)}`
                );
            }
            if (cadenceChanged) {
                reasons.push(`cadence changed: '${exactMatch.cadence}' → '${detected.cadence}'`);
            }
            return {
                classification: "update",
                matchedPatternId: exactMatch.id,
                matchedPatternDisplayName: exactMatch.displayName,
                updateReason: reasons.join("; "),
            };
        }

        return {
            classification: "already_represented",
            matchedPatternId: exactMatch.id,
            matchedPatternDisplayName: exactMatch.displayName,
        };
    }

    // ── Step 2: Semantic overlap check ────────────────────────────────────
    // Only check patterns in the same direction as the detected pattern.
    const candidateSearchStr = `${detected.displayName} ${detected.merchantKey}`;
    const overlapCandidates: NonNullable<ClassificationResult["overlapCandidates"]> = [];
    const genericTerms = new Set(['payment', 'loan', 'insurance', 'subscription', 'transfer', 'deposit', 'withdrawal', 'fee', 'ach', 'wire', 'check', 'credit', 'debit', 'bank', 'vehicle', 'equipment', 'truck', 'van', 'auto', 'car', 'llc', 'inc', 'co', 'corp']);

    for (const ep of existingPatterns) {
        if (ep.direction.toLowerCase() !== detectedDir) continue;

        const existingSearchStr = `${ep.displayName} ${ep.merchantKey}`;
        const overlap = tokenOverlapRatio(candidateSearchStr, existingSearchStr);
        
        // Split existing pattern into segments to check for group members
        // Structural separators: comma, &, "and", +, semicolon
        const isGrouped = /[,&+\;]|\band\b/i.test(ep.displayName) || /[,&+\;]|\band\b/i.test(ep.merchantKey);
        let isGroupMember = false;

        if (isGrouped) {
            const displaySegments = ep.displayName.split(/[,&+\;]|\band\b/i).map(s => s.trim()).filter(s => s.length > 0);
            const keySegments = ep.merchantKey.split(/[,&+\;]|\band\b/i).map(s => s.trim()).filter(s => s.length > 0);
            
            // To be safe, we can check each display segment + its corresponding key segment, or just check them all.
            // Let's just check them all independently. A member segment should match if either its display or key form matches.
            const segments = [...displaySegments, ...keySegments];
            const detToks = significantTokens(candidateSearchStr);
            
            for (const segment of segments) {
                const segToks = significantTokens(segment);
                if (segToks.size === 0 || detToks.size === 0) continue;

                let commonTokens = 0;
                let hasStrongIdentifier = false;

                for (const t of detToks) {
                    if (segToks.has(t)) {
                        commonTokens++;
                        if (/\d/.test(t) && !genericTerms.has(t)) {
                            hasStrongIdentifier = true;
                        }
                    }
                }

                const asymCoverage = commonTokens / detToks.size;
                if (asymCoverage >= 0.5) {
                    if (asymCoverage === 1.0 || commonTokens >= 2 || hasStrongIdentifier) {
                        isGroupMember = true;
                        break;
                    }
                }
            }
        }

        // For group members, amount difference is ignored.
        // For symmetric matches, overlap must be >= tokenOverlapThreshold
        if (!isGroupMember && overlap < tokenOverlapThreshold) continue;

        const amountDiff = ep.typicalAmount > 0
            ? Math.abs(detected.typicalAmount - ep.typicalAmount) / ep.typicalAmount
            : 1;

        const isStrongTextualEvidence = isGrouped ? isGroupMember : (overlap >= 0.66);
        console.log("DEBUG CLASSIFY:", { 
            detected: detected.displayName, 
            ep: ep.displayName, 
            isGrouped, 
            isGroupMember, 
            overlap, 
            amountDiff, 
            amountToleranceRatio, 
            isStrongTextualEvidence 
        });
        if (amountDiff > amountToleranceRatio && !isStrongTextualEvidence) continue;

        // Cadence must be compatible (same or one is "irregular")
        const cadenceCompat =
            detected.cadence === ep.cadence ||
            detected.cadence === "irregular" ||
            ep.cadence === "irregular";
        if (!cadenceCompat) continue;

        // If it survives to here, it's a semantic overlap candidate!
        overlapCandidates.push({
            id: ep.id,
            displayName: ep.displayName,
            typicalAmount: ep.typicalAmount,
            cadence: ep.cadence,
            tokenOverlap: Math.round((isGroupMember ? 1.0 : overlap) * 100) / 100,
            amountDiff: Math.round(amountDiff * 100) / 100,
            debug: { isGrouped, isGroupMember, isStrongTextualEvidence },
        } as any);
    }

    if (overlapCandidates.length > 0) {
        return { classification: "ambiguous_overlap", overlapCandidates };
    }

    // ── Step 3: No match ──────────────────────────────────────────────────
    return { classification: "genuinely_new" };
}

