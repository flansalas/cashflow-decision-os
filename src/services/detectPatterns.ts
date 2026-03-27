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
function normalizeDescription(raw: string): string {
    let s = raw.trim().toUpperCase();

    // Remove leading/trailing transaction IDs like "POS #3948", ref numbers, etc.
    // Remove trailing sequences of digits (transaction IDs)
    s = s.replace(/\s+\d{4,}\s*$/, "");

    // Remove common bank prefixes
    s = s.replace(/^(POS |ACH |CHECK |DEBIT |WIRE |XFER |EFT |CCD |CHECKCARD |DDA |WEB )/i, "");

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
function categorize(displayName: string): string {
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
    dt.setDate(dt.getDate() + n);
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

        // Skip already-known recurring patterns
        if (existingMerchantKeys.has(key)) continue;

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
