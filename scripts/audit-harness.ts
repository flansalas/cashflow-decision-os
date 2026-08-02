import * as fs from "fs";
import * as path from "path";
import { startOfWeek, addWeeks, differenceInCalendarWeeks, nextMonday, previousSunday, format, isBefore, isAfter, isEqual } from "date-fns";
import { computeBaseline, BankTxForBaseline } from "../src/services/baseline";

const DATA_PATH = "/Users/flans/.gemini/antigravity/brain/590e3c4a-bfe1-4fd1-b1ec-32af15124be6/scratch/frozen_backtest_dataset.json";

interface FrozenRow {
    sourceRow: number;
    account: string;
    date: string;
    type: string;
    num: string;
    name: string;
    description: string;
    amount: number;
    balance: number;
    isConfirmedInternalTransfer: boolean;
    duplicateReviewStatus: string;
    memo: string;
    split: string;
}

function loadData(): FrozenRow[] {
    return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
}

function getWeeklyBuckets(txs: FrozenRow[], startDate: Date, weeks: number) {
    const buckets = Array.from({ length: weeks }, () => ({ inflow: 0, outflow: 0 }));
    for (const tx of txs) {
        const txDate = new Date(tx.date);
        const w = differenceInCalendarWeeks(txDate, startDate, { weekStartsOn: 1 });
        if (w >= 0 && w < weeks) {
            if (tx.amount > 0) buckets[w].inflow += tx.amount;
            else buckets[w].outflow += Math.abs(tx.amount);
        }
    }
    return buckets;
}

// Exactly match baseline.ts math
function computeWeightedMeanAndStdDev(values: number[], weights: number[]) {
    let sumWeight = 0;
    let sumValue = 0;
    for (let i = 0; i < values.length; i++) {
        sumWeight += weights[i];
        sumValue += values[i] * weights[i];
    }
    if (sumWeight === 0) return { mean: 0, stddev: 0 };
    const mean = sumValue / sumWeight;
    let sumSqDiff = 0;
    let nonZeroWeights = 0;
    for (let i = 0; i < values.length; i++) {
        sumSqDiff += weights[i] * Math.pow(values[i] - mean, 2);
        if (weights[i] > 0) nonZeroWeights++;
    }
    const variance = (nonZeroWeights > 1) ? sumSqDiff / sumWeight : 0; // Simplified variance estimation for weights
    return { mean, stddev: Math.sqrt(variance) };
}

function trimmedValues(values: number[], trimPct: number) {
    if (values.length === 0) return [];
    const sorted = [...values].sort((a, b) => a - b);
    const trimCount = Math.floor(sorted.length * trimPct);
    return sorted.slice(trimCount, sorted.length - trimCount);
}

function median(values: number[]) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Replicate exactly what M1 does to trace the logic
function traceM1Logic(buckets: { inflow: number, outflow: number }[]) {
    const inflowValues: number[] = [];
    const outflowValues: number[] = [];
    const weights: number[] = [];

    const firstActiveIdx = buckets.findIndex(b => b.inflow > 0 || b.outflow > 0);
    const lastActiveIdx = buckets.length - 1 - [...buckets].reverse().findIndex(b => b.inflow > 0 || b.outflow > 0);

    for (let i = 0; i < 52; i++) {
        if (firstActiveIdx !== -1 && (i < firstActiveIdx || i > lastActiveIdx)) continue;
        const ageWeeks = 51 - i;
        let weight = 1.0;
        if (ageWeeks <= 3) weight = 2.0;
        else if (ageWeeks <= 7) weight = 1.5;
        else if (ageWeeks <= 12) weight = 1.0;
        else if (ageWeeks <= 25) weight = 0.7;
        else weight = 0.4;
        
        inflowValues.push(buckets[i].inflow);
        outflowValues.push(buckets[i].outflow);
        weights.push(weight);
    }

    const inStats = computeWeightedMeanAndStdDev(inflowValues, weights);
    const outStats = computeWeightedMeanAndStdDev(outflowValues, weights);
    
    const inCV = inStats.mean > 0 ? inStats.stddev / inStats.mean : 0;
    const outCV = outStats.mean > 0 ? outStats.stddev / outStats.mean : 0;
    
    const inTrimmed = trimmedValues(inflowValues, 0.05);
    const inMedian = median(inTrimmed);
    const outTrimmed = trimmedValues(outflowValues, 0.05);
    const outMedian = median(outTrimmed);
    
    const inBranch = inCV >= 0.8 ? "Mean" : "Median";
    const outBranch = outCV >= 0.8 ? "Mean" : "Median";
    
    return {
        inflow: {
            weightedMean: inStats.mean,
            trimmedMedian: inMedian,
            stddev: inStats.stddev,
            cv: inCV,
            branch: inBranch,
            finalScalar: inBranch === "Mean" ? inStats.mean : inMedian
        },
        outflow: {
            weightedMean: outStats.mean,
            trimmedMedian: outMedian,
            stddev: outStats.stddev,
            cv: outCV,
            branch: outBranch,
            finalScalar: outBranch === "Mean" ? outStats.mean : outMedian
        }
    };
}

// Challenger Models
function computeM2(buckets: { inflow: number, outflow: number }[]) {
    const last12 = buckets.slice(-12);
    return {
        inflow: last12.reduce((sum, b) => sum + b.inflow, 0) / 12,
        outflow: last12.reduce((sum, b) => sum + b.outflow, 0) / 12,
    };
}

function computeM3(buckets: { inflow: number, outflow: number }[]) {
    const last12 = buckets.slice(-12);
    return {
        inflow: median(last12.map(b => b.inflow)),
        outflow: median(last12.map(b => b.outflow))
    };
}

function computeM4(buckets: { inflow: number, outflow: number }[]) {
    const last26 = buckets.slice(-26);
    return {
        inflow: last26.reduce((sum, b) => sum + b.inflow, 0) / 26,
        outflow: last26.reduce((sum, b) => sum + b.outflow, 0) / 26,
    };
}

function computeM5(buckets: { inflow: number, outflow: number }[]) {
    // Pure weighted mean over 52 weeks, but ONLY over weeks where inflow/outflow > 0 respectively
    // Wait, the specification was "Production weighting without adaptive switching".
    // M1 uses joint active spans (skip weeks where BOTH are 0).
    // Let's implement M5 with independent active spans but pure weighted mean.
    const activeInflows = buckets.map((b, i) => ({ val: b.inflow, age: 51 - i })).filter(b => b.val > 0);
    const activeOutflows = buckets.map((b, i) => ({ val: b.outflow, age: 51 - i })).filter(b => b.val > 0);
    
    const getWeight = (ageWeeks: number) => {
        if (ageWeeks <= 3) return 2.0;
        if (ageWeeks <= 7) return 1.5;
        if (ageWeeks <= 12) return 1.0;
        if (ageWeeks <= 25) return 0.7;
        return 0.4;
    };
    
    let sumWIn = 0, sumVIn = 0;
    for (const b of activeInflows) {
        const w = getWeight(b.age);
        sumWIn += w;
        sumVIn += b.val * w;
    }
    
    let sumWOut = 0, sumVOut = 0;
    for (const b of activeOutflows) {
        const w = getWeight(b.age);
        sumWOut += w;
        sumVOut += b.val * w;
    }
    
    return {
        inflow: sumWIn > 0 ? sumVIn / sumWIn : 0,
        outflow: sumWOut > 0 ? sumVOut / sumWOut : 0
    };
}

function computeM1A(buckets: { inflow: number, outflow: number }[]) {
    // M1A: Independent active spans, same CV logic as M1
    const activeInflows = buckets.map((b, i) => ({ val: b.inflow, age: 51 - i })).filter(b => b.val > 0);
    const activeOutflows = buckets.map((b, i) => ({ val: b.outflow, age: 51 - i })).filter(b => b.val > 0);
    
    const getWeight = (ageWeeks: number) => {
        if (ageWeeks <= 3) return 2.0;
        if (ageWeeks <= 7) return 1.5;
        if (ageWeeks <= 12) return 1.0;
        if (ageWeeks <= 25) return 0.7;
        return 0.4;
    };
    
    const statsIn = computeWeightedMeanAndStdDev(activeInflows.map(b => b.val), activeInflows.map(b => getWeight(b.age)));
    const statsOut = computeWeightedMeanAndStdDev(activeOutflows.map(b => b.val), activeOutflows.map(b => getWeight(b.age)));
    
    const cvIn = statsIn.mean > 0 ? statsIn.stddev / statsIn.mean : 0;
    const cvOut = statsOut.mean > 0 ? statsOut.stddev / statsOut.mean : 0;
    
    const medIn = median(trimmedValues(activeInflows.map(b => b.val), 0.05));
    const medOut = median(trimmedValues(activeOutflows.map(b => b.val), 0.05));
    
    return {
        inflow: cvIn >= 0.8 ? statsIn.mean : medIn,
        outflow: cvOut >= 0.8 ? statsOut.mean : medOut
    };
}

function executeAudit() {
    const rawData = loadData();
    const data = rawData.filter(r => !r.isConfirmedInternalTransfer);
    
    // Origin Count Reconciliation
    // A complete week is Monday to Sunday.
    // First transaction date:
    const firstDate = new Date(data[0].date);
    // Find the first Monday
    let firstMonday = startOfWeek(firstDate, { weekStartsOn: 1 });
    if (isBefore(firstMonday, firstDate)) {
        firstMonday = addWeeks(firstMonday, 1);
    }
    
    // Last transaction date:
    const lastDate = new Date(data[data.length - 1].date);
    // Find the last complete Sunday
    let lastSunday = addWeeks(startOfWeek(lastDate, { weekStartsOn: 1 }), 1); // This is next Monday
    lastSunday = new Date(lastSunday.getTime() - 1); // Sunday 23:59:59
    if (isAfter(lastSunday, lastDate)) {
        lastSunday = new Date(startOfWeek(lastDate, { weekStartsOn: 1 }).getTime() - 1);
    }
    
    const totalCompleteWeeks = Math.floor((lastSunday.getTime() - firstMonday.getTime() + 1) / (7 * 86400 * 1000));
    const totalOrigins = totalCompleteWeeks - 52 - 13 + 1;
    
    console.log(`First Tx Date: ${format(firstDate, "yyyy-MM-dd")}`);
    console.log(`First Complete Monday: ${format(firstMonday, "yyyy-MM-dd")}`);
    console.log(`Last Tx Date: ${format(lastDate, "yyyy-MM-dd")}`);
    console.log(`Last Complete Sunday: ${format(lastSunday, "yyyy-MM-dd")}`);
    console.log(`Total Complete Weeks: ${totalCompleteWeeks}`);
    console.log(`Usable 52w/13w Origins: ${totalOrigins}`);
    
    const originsData = [];
    let results: any[] = [];
    let m1TraceLogs: any[] = [];
    
    for (let o = 0; o < totalOrigins; o++) {
        const originStart = addWeeks(firstMonday, o);
        const originEnd = addWeeks(originStart, 52); // Cutoff Monday
        const horizonEnd = addWeeks(originEnd, 13);
        
        const trainData = data.filter(r => { const d = new Date(r.date); return d >= originStart && d < originEnd; });
        const actualData = data.filter(r => { const d = new Date(r.date); return d >= originEnd && d < horizonEnd; });
        
        originsData.push({
            origin: o + 1,
            cutoffMonday: format(originEnd, "yyyy-MM-dd"),
            trainStart: format(originStart, "yyyy-MM-dd"),
            trainEnd: format(originEnd, "yyyy-MM-dd"), // actually exclusive bound
            horizonStart: format(originEnd, "yyyy-MM-dd"),
            horizonEnd: format(horizonEnd, "yyyy-MM-dd"),
            trainWeeks: 52,
            horizonWeeks: 13,
            trainTxCount: trainData.length,
            actualTxCount: actualData.length
        });
        
        const txsForM1: BankTxForBaseline[] = trainData.map(r => ({
            amount: r.amount,
            date: new Date(r.date),
            merchantKey: r.name || r.memo || r.description || "Unknown"
        }));
        
        const m1Res = computeBaseline(txsForM1, [], originEnd);
        const trainBuckets = getWeeklyBuckets(trainData, originStart, 52);
        
        // Trace M1 Logic directly
        const m1Trace = traceM1Logic(trainBuckets);
        m1TraceLogs.push({
            origin: o + 1,
            ...m1Trace
        });
        
        const m1aRes = computeM1A(trainBuckets);
        const m2Res = computeM2(trainBuckets);
        const m3Res = computeM3(trainBuckets);
        const m4Res = computeM4(trainBuckets);
        const m5Res = computeM5(trainBuckets);
        
        const models = {
            "M1": { inflow: m1Res.variableInflowWeekly, outflow: m1Res.variableOutflowWeekly },
            "M1A": m1aRes,
            "M2": m2Res,
            "M3": m3Res,
            "M4": m4Res,
            "M5": m5Res,
        };
        
        const actualBuckets = getWeeklyBuckets(actualData, originEnd, 13);
        
        for (let w = 0; w < 13; w++) {
            const actIn = actualBuckets[w].inflow;
            const actOut = actualBuckets[w].outflow;
            
            for (const [mName, mPred] of Object.entries(models)) {
                results.push({
                    origin: o + 1,
                    model: mName,
                    horizon: w + 1,
                    inflowPred: mPred.inflow,
                    inflowActual: actIn,
                    outflowPred: mPred.outflow,
                    outflowActual: actOut,
                    inflowAbsErr: Math.abs(mPred.inflow - actIn),
                    outflowAbsErr: Math.abs(mPred.outflow - actOut),
                    inflowErr: mPred.inflow - actIn,
                    outflowErr: mPred.outflow - actOut
                });
            }
        }
    }
    
    fs.writeFileSync(path.join(__dirname, "../audit_results.json"), JSON.stringify({
        originsData,
        m1TraceLogs,
        results
    }, null, 2));
    
    console.log(`Audit execution complete. Data saved to audit_results.json`);
}

executeAudit();
