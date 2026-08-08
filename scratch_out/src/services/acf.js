"use strict";
/**
 * Autocorrelation Function (ACF) - Cadence Detection
 *
 * This service provides mathematical autocorrelation scaffolding
 * to automatically detect repeating payment/payroll cadences directly
 * from historical bank transaction feeds.
 *
 * Sprint 3 Goal: Integrate this with the async worker to automatically
 * populate `RecurringPattern` records without manual user input.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeACF = computeACF;
exports.detectDominantCadence = detectDominantCadence;
/**
 * Computes the Autocorrelation Function (ACF) for a given time series.
 * @param series Array of numerical values (e.g., daily cash flow amounts)
 * @param maxLag Maximum lag (in days) to compute ACF for
 * @returns Array of correlation coefficients [lag 0, lag 1, ... lag maxLag]
 */
function computeACF(series, maxLag) {
    const n = series.length;
    if (n === 0)
        return [];
    // Calculate mean
    const mean = series.reduce((a, b) => a + b, 0) / n;
    // Calculate variance
    let variance = 0;
    for (let i = 0; i < n; i++) {
        variance += Math.pow(series[i] - mean, 2);
    }
    if (variance === 0)
        return Array(maxLag + 1).fill(0);
    const acf = [];
    for (let lag = 0; lag <= maxLag; lag++) {
        let cov = 0;
        for (let i = 0; i < n - lag; i++) {
            cov += (series[i] - mean) * (series[i + lag] - mean);
        }
        acf.push(cov / variance);
    }
    return acf;
}
/**
 * Detects the dominant repeating cadence from an ACF array.
 * @param acf Array of ACF values where index is the lag (e.g. days)
 * @param threshold Minimum correlation threshold to consider it a repeating pattern
 * @returns Detected lag (e.g. 7 for weekly, 14 for biweekly) or null if no strong signal
 */
function detectDominantCadence(acf, threshold = 0.5) {
    let maxCorrelation = 0;
    let dominantLag = null;
    // Skip lag 0 (which is always 1) and small lags < 3 (too noisy)
    for (let lag = 3; lag < acf.length; lag++) {
        if (acf[lag] > maxCorrelation && acf[lag] >= threshold) {
            maxCorrelation = acf[lag];
            dominantLag = lag;
        }
    }
    return dominantLag;
}
