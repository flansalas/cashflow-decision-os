"use strict";
// services/baseline.ts – Compute variable inflow/outflow baselines from bank transactions
// Pure logic. No React, no DB imports.
// Strategy A: computes real values from last 8–12 weeks of bank tx,
// excluding detected recurring patterns (payroll, rent, etc.)
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
exports.computeBaseline = computeBaseline;
var detectPatterns_1 = require("./detectPatterns");
// Minimum weeks required to trust the baseline
var MIN_WEEKS_REQUIRED = 6;
var WEEKS_TO_ANALYZE = 12;
function computeBaseline(txs, patterns, asOfDate) {
    if (txs.length === 0) {
        return placeholderBaseline("No bank transactions available");
    }
    // Build set of recurring merchantKeys to exclude
    // Using normalizeDescription for identity and allowing a 30% or 2*stddev bounds check
    var excludedPatterns = patterns
        .filter(function (p) { return p.isIncluded; })
        .map(function (p) { return ({
        key: (0, detectPatterns_1.normalizeDescription)(p.merchantKey || ""),
        direction: p.direction,
        minAmount: p.typicalAmount - Math.max(p.typicalAmount * 0.3, p.amountStdDev * 2),
        maxAmount: p.typicalAmount + Math.max(p.typicalAmount * 0.3, p.amountStdDev * 2)
    }); });
    // Compute week boundaries: last WEEKS_TO_ANALYZE complete weeks before asOfDate
    var weekBuckets = [];
    var weekStart0 = mondayBefore(asOfDate, WEEKS_TO_ANALYZE);
    for (var i = 0; i < WEEKS_TO_ANALYZE; i++) {
        var wStart = addWeeks(weekStart0, i);
        var wEnd = addDays(wStart, 6);
        var inflowSum = 0;
        var outflowSum = 0;
        var _loop_1 = function (tx) {
            if (tx.date < wStart || tx.date > wEnd)
                return "continue";
            // Exclude known recurring patterns
            var normalizedTxKey = (0, detectPatterns_1.normalizeDescription)(tx.merchantKey || "");
            var txDirection = tx.amount >= 0 ? "inflow" : "outflow";
            var absAmount = Math.abs(tx.amount);
            var isExcluded = excludedPatterns.some(function (p) {
                return p.key === normalizedTxKey &&
                    p.direction === txDirection &&
                    absAmount >= p.minAmount &&
                    absAmount <= p.maxAmount;
            });
            if (isExcluded)
                return "continue";
            if (tx.amount > 0) {
                inflowSum += tx.amount;
            }
            else {
                outflowSum += Math.abs(tx.amount);
            }
        };
        for (var _i = 0, txs_1 = txs; _i < txs_1.length; _i++) {
            var tx = txs_1[_i];
            _loop_1(tx);
        }
        weekBuckets.push({ inflow: inflowSum, outflow: outflowSum });
    }
    // Find weeks with at least some activity
    var activeWeeks = weekBuckets.filter(function (b) { return b.inflow > 0 || b.outflow > 0; });
    if (activeWeeks.length < MIN_WEEKS_REQUIRED) {
        return placeholderBaseline("Only ".concat(activeWeeks.length, " weeks of transaction history (need ").concat(MIN_WEEKS_REQUIRED, ")"));
    }
    var inflowValues = [];
    var outflowValues = [];
    var weights = [];
    // Compute weights and build arrays for robust statistics
    for (var i = 0; i < WEEKS_TO_ANALYZE; i++) {
        var b = weekBuckets[i];
        if (b.inflow === 0 && b.outflow === 0)
            continue; // Skip inactive weeks
        var ageWeeks = (WEEKS_TO_ANALYZE - 1) - i;
        var weight = 1.0;
        // Tiered weights: Most recent 4 weeks get highest weight
        if (ageWeeks <= 3)
            weight = 1.5; // Weeks 1-4
        else if (ageWeeks <= 7)
            weight = 0.9; // Weeks 5-8
        else
            weight = 0.6; // Weeks 9-12
        inflowValues.push(b.inflow);
        outflowValues.push(b.outflow);
        weights.push(weight);
    }
    // Apply basic outlier shielding (cap at 2.5x median)
    var cappedInflows = clipOutliers(inflowValues);
    var cappedOutflows = clipOutliers(outflowValues);
    var calcStat = computeWeightedMeanAndStdDev(cappedInflows, weights);
    var variableInflowWeekly = calcStat.mean;
    var inflowStdDev = calcStat.stddev;
    var calcOutStat = computeWeightedMeanAndStdDev(cappedOutflows, weights);
    var variableOutflowWeekly = calcOutStat.mean;
    var outflowStdDev = calcOutStat.stddev;
    var variableInflowBand = variableInflowWeekly > 0
        ? Math.min(0.6, inflowStdDev / variableInflowWeekly)
        : 0.3;
    var variableOutflowBand = variableOutflowWeekly > 0
        ? Math.min(0.4, outflowStdDev / variableOutflowWeekly)
        : 0.2;
    return {
        variableOutflowWeekly: Math.round(variableOutflowWeekly * 100) / 100,
        variableInflowWeekly: Math.round(variableInflowWeekly * 100) / 100,
        variableOutflowBand: Math.round(variableOutflowBand * 100) / 100,
        variableInflowBand: Math.round(variableInflowBand * 100) / 100,
        weeksAnalyzed: activeWeeks.length,
        hasSufficientHistory: true,
        computedFrom: "bank_tx",
        note: "Computed from ".concat(activeWeeks.length, " weeks of bank tx, excluding ").concat(excludedPatterns.length, " recurring patterns"),
    };
}
// ─── Helpers ─────────────────────────────────────────────────────────────
function placeholderBaseline(reason) {
    return {
        variableOutflowWeekly: 0,
        variableInflowWeekly: 0,
        variableOutflowBand: 0.2,
        variableInflowBand: 0.3,
        weeksAnalyzed: 0,
        hasSufficientHistory: false,
        computedFrom: "placeholder",
        note: "Baseline uses placeholder defaults \u2014 ".concat(reason),
    };
}
function mondayBefore(d, weeksAgo) {
    var dt = new Date(d);
    var day = dt.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    dt.setDate(dt.getDate() + diff - weeksAgo * 7);
    dt.setHours(0, 0, 0, 0);
    return dt;
}
function addWeeks(d, n) {
    var dt = new Date(d);
    dt.setDate(dt.getDate() + n * 7);
    return dt;
}
function addDays(d, n) {
    var dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
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
function median(values) {
    if (values.length === 0)
        return 0;
    var sorted = __spreadArray([], values, true).sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function clipOutliers(values) {
    if (values.length === 0)
        return [];
    var med = median(values);
    if (med === 0)
        return values;
    var cap = med * 2.5;
    return values.map(function (v) { return v > cap ? cap : v; });
}
function computeWeightedMeanAndStdDev(values, weights) {
    var sumW = weights.reduce(function (a, b) { return a + b; }, 0);
    if (sumW === 0)
        return { mean: 0, stddev: 0 };
    var mean = 0;
    for (var i = 0; i < values.length; i++)
        mean += values[i] * weights[i];
    mean /= sumW;
    var variance = 0;
    for (var i = 0; i < values.length; i++)
        variance += weights[i] * Math.pow(values[i] - mean, 2);
    // using basic weighted variance
    variance /= sumW;
    // Fallback: if capped values still yield extremely high standard deviation, cap variance logically.
    return { mean: mean, stddev: Math.sqrt(variance) };
}
