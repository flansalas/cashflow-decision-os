"use strict";
// services/detectPatterns.ts – Detect recurring outflow patterns from bank transactions
// Pure logic. No React, no DB imports.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SUGGESTIONS = exports.MIN_AMOUNT = exports.MIN_OCCURRENCES = void 0;
exports.normalizeDescription = normalizeDescription;
exports.categorize = categorize;
exports.detectPatterns = detectPatterns;
exports.isRecurringIdentityMatch = isRecurringIdentityMatch;
// ─── Normalization ───────────────────────────────────────────────────────────
// Strip common bank noise from descriptions to get a consistent merchant key
function normalizeDescription(raw) {
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
function categorize(displayName) {
    const name = displayName.toLowerCase();
    if (/payroll|adp|paychex|gusto|rippling|bamboo|paylocity|quickbooks pay|intuit pay/.test(name))
        return "payroll";
    if (/rent|lease|property|realty|landlord/.test(name))
        return "rent";
    if (/loan|mortgage|lender|financing|credit union|sba|bank payment|note pay/.test(name))
        return "loan";
    if (/amazon|google|apple|microsoft|adobe|dropbox|slack|zoom|hubspot|salesforce|quickbooks|intuit|godaddy|shopify|twilio|stripe/.test(name))
        return "subscription";
    if (/electric|water|gas|utility|utilities|power|energy|duke|pge|fpl|xcel/.test(name))
        return "utilities";
    if (/fuel|gas station|shell|bp |exxon|chevron|pilot|loves|wawa|speedway|circle k|petro/.test(name))
        return "fuel";
    if (/insurance|ins |allstate|geico|state farm|progressive|nationwide/.test(name))
        return "other";
    if (/tax|irs|state revenue|dept of revenue|revenue dept/.test(name))
        return "taxes";
    if (/visa|mastercard|amex|american express|discover|capital one|citibank|chase sapphire/.test(name))
        return "card_payment";
    if (/supplies|material|home depot|lowes|grainger|mcmaster|fastenal|uline/.test(name))
        return "materials";
    return "other";
}
// ─── Interval Analysis ───────────────────────────────────────────────────────
function median(values) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}
function detectCadence(intervalDays) {
    if (intervalDays.length === 0)
        return "irregular";
    const med = median(intervalDays);
    if (med >= 5 && med <= 9)
        return "weekly";
    if (med >= 10 && med <= 18)
        return "biweekly";
    if (med >= 25 && med <= 35)
        return "monthly";
    return "irregular";
}
function cadenceIntervalDays(cadence) {
    if (cadence === "weekly")
        return 7;
    if (cadence === "biweekly")
        return 14;
    if (cadence === "monthly")
        return 30;
    return 30; // fallback for irregular
}
function mean(values) {
    if (values.length === 0)
        return 0;
    return values.reduce((s, v) => s + v, 0) / values.length;
}
function stddev(values) {
    if (values.length < 2)
        return 0;
    const m = mean(values);
    const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}
function addDays(d, n) {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
}
// ─── Main Detection ──────────────────────────────────────────────────────────
exports.MIN_OCCURRENCES = 2;
exports.MIN_AMOUNT = 25; // ignore tiny noise transactions
exports.MAX_SUGGESTIONS = 20; // cap suggestions shown to user
function detectPatterns(txs, asOfDate, existingMerchantKeys = new Set()) {
    // Only analyze outflows
    const outflows = txs.filter(tx => tx.direction === "outflow" && tx.amount >= exports.MIN_AMOUNT);
    // Group by normalized merchant key
    const groups = new Map();
    for (const tx of outflows) {
        const key = normalizeDescription(tx.description);
        if (!key || key.length < 3)
            continue; // skip empty / very short keys
        if (!groups.has(key)) {
            groups.set(key, { raw: tx.description, dates: [], amounts: [] });
        }
        const g = groups.get(key);
        g.dates.push(new Date(tx.txDate));
        g.amounts.push(tx.amount);
    }
    const suggestions = [];
    for (const [key, data] of groups) {
        if (data.dates.length < exports.MIN_OCCURRENCES)
            continue;
        // We no longer skip existing patterns here.
        // The API route will cross-reference with DB to determine if it's a NEW vs UPDATE suggestion.
        // if (existingMerchantKeys.has(key)) continue;
        // Sort dates ascending
        data.dates.sort((a, b) => a.getTime() - b.getTime());
        // Compute intervals
        const intervals = [];
        for (let i = 1; i < data.dates.length; i++) {
            const daysDiff = Math.round((data.dates[i].getTime() - data.dates[i - 1].getTime()) / 86_400_000);
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
        let confidence;
        if (cvRatio < 0.08 && avgIntervalDeviation <= 3 && data.dates.length >= 3) {
            confidence = "high";
        }
        else if (cvRatio < 0.25 && avgIntervalDeviation <= 7) {
            confidence = "med";
        }
        else {
            confidence = "low";
        }
        // Don't bother suggesting irregular+low confidence items — too noisy
        if (cadence === "irregular" && confidence === "low")
            continue;
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
    return suggestions.slice(0, exports.MAX_SUGGESTIONS);
}
function isRecurringIdentityMatch(tx, pattern, lastMatchedDate, cadence) {
    if (tx.direction !== pattern.direction)
        return false;
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
    if (!isIdentityMatch)
        return false;
    // Must also be within reasonable amount bounds (+/- 50% or 2 stddev)
    const absAmount = Math.abs(tx.amount);
    const minAmount = pattern.typicalAmount - Math.max(pattern.typicalAmount * 0.5, pattern.amountStdDev * 2);
    const maxAmount = pattern.typicalAmount + Math.max(pattern.typicalAmount * 0.5, pattern.amountStdDev * 2);
    if (absAmount < minAmount || absAmount > maxAmount)
        return false;
    // Enforce cadence / timing check if available
    const cadenceStr = cadence || pattern.cadence;
    // 1. Cadence Cooldown Check
    if (lastMatchedDate && cadenceStr) {
        const daysSince = Math.abs(Math.round((tx.txDate.getTime() - lastMatchedDate.getTime()) / 86400000));
        const cooldown = cadenceStr === "weekly" ? 5 : cadenceStr === "biweekly" ? 12 : 26;
        if (daysSince < cooldown)
            return false; // Too soon since last match
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
