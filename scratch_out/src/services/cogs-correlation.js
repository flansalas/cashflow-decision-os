"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeCOGSCorrelation = computeCOGSCorrelation;
function computeCOGSCorrelation(weeklyBuckets) {
    let activeWeeks = 0;
    let totalVarInflow = 0;
    let totalVarOutflow = 0;
    for (const b of weeklyBuckets) {
        if (b.inflow > 0 || b.outflow > 0)
            activeWeeks++;
        totalVarInflow += b.inflow;
        totalVarOutflow += b.outflow;
    }
    let cashMarginRatio = 0.3; // fallback 30% margin
    if (totalVarInflow > 0) {
        cashMarginRatio = 1 - (totalVarOutflow / totalVarInflow);
        // Clamp to sane values for a business (5% to 80% margin)
        cashMarginRatio = Math.max(0.05, Math.min(0.80, cashMarginRatio));
    }
    let cogsLagWeeks = 0; // fallback
    // Compute cross-correlation (lag 0-6 weeks) to find delay
    if (activeWeeks >= 12) {
        let bestLag = 0;
        let maxCorr = -1;
        const inflows = weeklyBuckets.map(b => b.inflow);
        const outflows = weeklyBuckets.map(b => b.outflow);
        const inMean = totalVarInflow / weeklyBuckets.length;
        const outMean = totalVarOutflow / weeklyBuckets.length;
        for (let lag = 0; lag <= 6; lag++) {
            let numerator = 0;
            let denomIn = 0;
            let denomOut = 0;
            for (let i = 0; i < weeklyBuckets.length - lag; i++) {
                const inDiff = inflows[i] - inMean;
                const outDiff = outflows[i + lag] - outMean;
                numerator += inDiff * outDiff;
                denomIn += inDiff * inDiff;
                denomOut += outDiff * outDiff;
            }
            if (denomIn > 0 && denomOut > 0) {
                const corr = numerator / Math.sqrt(denomIn * denomOut);
                if (corr > maxCorr) {
                    maxCorr = corr;
                    bestLag = lag;
                }
            }
        }
        // Only adopt the lag if the correlation is somewhat meaningful
        if (maxCorr > 0.3) {
            cogsLagWeeks = bestLag;
        }
    }
    const confidence = activeWeeks >= 12 ? "high" : activeWeeks >= 6 ? "med" : "low";
    return {
        cashMarginRatio,
        cogsLagWeeks,
        confidence,
        weeksAnalyzed: activeWeeks,
    };
}
