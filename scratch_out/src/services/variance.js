"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeVarianceMultipliers = computeVarianceMultipliers;
function computeVarianceMultipliers(ledger, eligibleRowIds = new Set()) {
    if (ledger.length === 0) {
        return { inflow: 1.0, outflow: 1.0 };
    }
    // 1. Deduplicate timezone-shifted rows for the same calendar week
    const uniqueLedger = [];
    const seenWeeks = new Set();
    for (const row of ledger) {
        // Normalize to YYYY-MM-DD
        const weekStr = row.weekStart.toISOString().slice(0, 10);
        if (!seenWeeks.has(weekStr)) {
            seenWeeks.add(weekStr);
            uniqueLedger.push(row);
        }
    }
    // 2. Filter out outliers (>2.5x variance) and unverified rows
    // variancePct = (actual - expected) / expected
    // >2.5x means actual/expected > 2.5, which is variancePct > 1.5
    // also exclude massive drops if variancePct < -0.9? The prompt says ">2.5x outliers"
    const validOutflow = uniqueLedger.filter(v => eligibleRowIds.has(v.id) &&
        v.variancePct <= 1.5 &&
        v.variancePct >= -1.0);
    const validInflow = uniqueLedger.filter(v => eligibleRowIds.has(v.id) &&
        v.variancePctIn !== null &&
        v.variancePctIn <= 1.5 &&
        v.variancePctIn >= -1.0);
    const computeArithmetic = (items, isInflow) => {
        if (items.length === 0)
            return 1.0;
        const n = items.length;
        // Arithmetic weights: e.g. [8, 7, 6, 5, 4, 3, 2, 1] for 8 items.
        // Wait, the ledger is sorted desc (most recent first).
        // So items[0] gets weight N, items[N-1] gets weight 1.
        let sumWeights = 0;
        let weightedSum = 0;
        for (let i = 0; i < n; i++) {
            const weight = n - i;
            const item = items[i];
            const val = isInflow ? item.variancePctIn : item.variancePct;
            // Clip at +/- 75%
            const clipped = Math.max(-0.75, Math.min(0.75, val));
            weightedSum += clipped * weight;
            sumWeights += weight;
        }
        const avg = weightedSum / sumWeights;
        return Math.max(0.5, Math.min(2.0, 1 + avg));
    };
    return {
        outflow: computeArithmetic(validOutflow, false),
        inflow: computeArithmetic(validInflow, true)
    };
}
