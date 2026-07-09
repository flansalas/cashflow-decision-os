"use strict";
// services/detectPatterns.ts – Detect recurring outflow patterns from bank transactions
// Pure logic. No React, no DB imports.
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_SUGGESTIONS = exports.MIN_AMOUNT = exports.MIN_OCCURRENCES = void 0;
exports.normalizeDescription = normalizeDescription;
exports.detectPatterns = detectPatterns;
// ─── Normalization ───────────────────────────────────────────────────────────
// Strip common bank noise from descriptions to get a consistent merchant key
function normalizeDescription(raw) {
    var s = raw.trim().toUpperCase();
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
function categorize(displayName) {
    var name = displayName.toLowerCase();
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
    var sorted = __spreadArray([], values, true).sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}
function detectCadence(intervalDays) {
    if (intervalDays.length === 0)
        return "irregular";
    var med = median(intervalDays);
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
    return values.reduce(function (s, v) { return s + v; }, 0) / values.length;
}
function stddev(values) {
    if (values.length < 2)
        return 0;
    var m = mean(values);
    var variance = values.reduce(function (s, v) { return s + Math.pow((v - m), 2); }, 0) / (values.length - 1);
    return Math.sqrt(variance);
}
function addDays(d, n) {
    var dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
}
// ─── Main Detection ──────────────────────────────────────────────────────────
exports.MIN_OCCURRENCES = 2;
exports.MIN_AMOUNT = 25; // ignore tiny noise transactions
exports.MAX_SUGGESTIONS = 20; // cap suggestions shown to user
function detectPatterns(txs, asOfDate, existingMerchantKeys) {
    if (existingMerchantKeys === void 0) { existingMerchantKeys = new Set(); }
    // Only analyze outflows
    var outflows = txs.filter(function (tx) { return tx.direction === "outflow" && tx.amount >= exports.MIN_AMOUNT; });
    // Group by normalized merchant key
    var groups = new Map();
    for (var _i = 0, outflows_1 = outflows; _i < outflows_1.length; _i++) {
        var tx = outflows_1[_i];
        var key = normalizeDescription(tx.description);
        if (!key || key.length < 3)
            continue; // skip empty / very short keys
        if (!groups.has(key)) {
            groups.set(key, { raw: tx.description, dates: [], amounts: [] });
        }
        var g = groups.get(key);
        g.dates.push(new Date(tx.txDate));
        g.amounts.push(tx.amount);
    }
    var suggestions = [];
    var _loop_1 = function (key, data) {
        if (data.dates.length < exports.MIN_OCCURRENCES)
            return "continue";
        // We no longer skip existing patterns here.
        // The API route will cross-reference with DB to determine if it's a NEW vs UPDATE suggestion.
        // if (existingMerchantKeys.has(key)) continue;
        // Sort dates ascending
        data.dates.sort(function (a, b) { return a.getTime() - b.getTime(); });
        // Compute intervals
        var intervals = [];
        for (var i = 1; i < data.dates.length; i++) {
            var daysDiff = Math.round((data.dates[i].getTime() - data.dates[i - 1].getTime()) / 86400000);
            intervals.push(daysDiff);
        }
        var cadence = detectCadence(intervals);
        // Compute amount stats
        var typicalAmount = mean(data.amounts);
        var amtStdDev = stddev(data.amounts);
        var cvRatio = typicalAmount > 0 ? amtStdDev / typicalAmount : 1;
        // Interval consistency score
        var intervalMed = median(intervals);
        var intervalVariance = intervals.map(function (i) { return Math.abs(i - intervalMed); });
        var avgIntervalDeviation = mean(intervalVariance);
        // Confidence scoring
        var confidence = void 0;
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
            return "continue";
        // Compute next expected date by projecting forward from last seen
        var intervalForCadence = cadenceIntervalDays(cadence);
        var nextExpectedDate = addDays(data.dates[data.dates.length - 1], intervalForCadence);
        // Roll forward until it's in the future
        while (nextExpectedDate < asOfDate) {
            nextExpectedDate = addDays(nextExpectedDate, intervalForCadence);
        }
        // Build a clean display name from the raw description
        // Take first 40 chars of the original (not the fully-lowercased version)
        var displayName = data.raw
            .replace(/\s{2,}/g, " ")
            .trim()
            .slice(0, 50);
        suggestions.push({
            merchantKey: key,
            displayName: displayName,
            cadence: cadence,
            typicalAmount: Math.round(typicalAmount * 100) / 100,
            amountStdDev: Math.round(amtStdDev * 100) / 100,
            confidence: confidence,
            occurrences: data.dates.length,
            firstSeen: data.dates[0],
            lastSeen: data.dates[data.dates.length - 1],
            nextExpectedDate: nextExpectedDate,
            category: categorize(displayName),
        });
    };
    for (var _a = 0, groups_1 = groups; _a < groups_1.length; _a++) {
        var _b = groups_1[_a], key = _b[0], data = _b[1];
        _loop_1(key, data);
    }
    // Sort: high confidence first, then by amount descending
    var confidenceOrder = { high: 0, med: 1, low: 2 };
    suggestions.sort(function (a, b) {
        if (confidenceOrder[a.confidence] !== confidenceOrder[b.confidence]) {
            return confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
        }
        return b.typicalAmount - a.typicalAmount;
    });
    return suggestions.slice(0, exports.MAX_SUGGESTIONS);
}
