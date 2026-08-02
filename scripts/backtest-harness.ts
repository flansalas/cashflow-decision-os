import * as fs from "fs";
import * as path from "path";
import { startOfWeek, addWeeks, differenceInCalendarWeeks } from "date-fns";
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

// Simple challenger models based on weekly buckets
function computeM2(buckets: { inflow: number, outflow: number }[]) {
    // Mean over trailing 12 weeks
    const last12 = buckets.slice(-12);
    return {
        inflow: last12.reduce((sum, b) => sum + b.inflow, 0) / 12,
        outflow: last12.reduce((sum, b) => sum + b.outflow, 0) / 12,
    };
}

function computeM3(buckets: { inflow: number, outflow: number }[]) {
    // Median over trailing 12 weeks
    const last12 = buckets.slice(-12);
    const inflows = last12.map(b => b.inflow).sort((a, b) => a - b);
    const outflows = last12.map(b => b.outflow).sort((a, b) => a - b);
    return {
        inflow: (inflows[5] + inflows[6]) / 2,
        outflow: (outflows[5] + outflows[6]) / 2,
    };
}

function computeM4(buckets: { inflow: number, outflow: number }[]) {
    // Mean over trailing 26 weeks
    const last26 = buckets.slice(-26);
    return {
        inflow: last26.reduce((sum, b) => sum + b.inflow, 0) / 26,
        outflow: last26.reduce((sum, b) => sum + b.outflow, 0) / 26,
    };
}

// M5: Production weighting without adaptive switching
function computeM5(buckets: { inflow: number, outflow: number }[]) {
    const activeInflows = buckets.filter(b => b.inflow > 0);
    const activeOutflows = buckets.filter(b => b.outflow > 0);
    
    // Weights: Recent 13w (w=3), Mid 13-26w (w=2), Older (w=1)
    const weightBucket = (val: number, idx: number, totalLen: number) => {
        const age = totalLen - idx;
        const w = age <= 13 ? 3 : age <= 26 ? 2 : 1;
        return { val, w };
    };
    
    const wIn = activeInflows.map((b, i) => weightBucket(b.inflow, i, activeInflows.length));
    const totalWIn = wIn.reduce((s, x) => s + x.w, 0);
    const inflow = totalWIn > 0 ? wIn.reduce((s, x) => s + x.val * x.w, 0) / totalWIn : 0;
    
    const wOut = activeOutflows.map((b, i) => weightBucket(b.outflow, i, activeOutflows.length));
    const totalWOut = wOut.reduce((s, x) => s + x.w, 0);
    const outflow = totalWOut > 0 ? wOut.reduce((s, x) => s + x.val * x.w, 0) / totalWOut : 0;

    return { inflow, outflow };
}

// M1A: Independent active spans
function computeM1A(buckets: { inflow: number, outflow: number }[]) {
    // Same as M5 essentially, but adaptive switching if CV > 0.8
    // We will approximate it by just doing M5 here, then computing CV
    const m5 = computeM5(buckets);
    
    const activeInflows = buckets.filter(b => b.inflow > 0).map(b => b.inflow);
    const activeOutflows = buckets.filter(b => b.outflow > 0).map(b => b.outflow);
    
    const meanIn = activeInflows.reduce((s, v) => s + v, 0) / (activeInflows.length || 1);
    const varIn = activeInflows.reduce((s, v) => s + Math.pow(v - meanIn, 2), 0) / (activeInflows.length || 1);
    const cvIn = (Math.sqrt(varIn) / meanIn) || 0;
    
    const meanOut = activeOutflows.reduce((s, v) => s + v, 0) / (activeOutflows.length || 1);
    const varOut = activeOutflows.reduce((s, v) => s + Math.pow(v - meanOut, 2), 0) / (activeOutflows.length || 1);
    const cvOut = (Math.sqrt(varOut) / meanOut) || 0;
    
    // Fall back to median if volatile
    const sortedIn = [...activeInflows].sort((a,b) => a-b);
    const medIn = sortedIn.length > 0 ? sortedIn[Math.floor(sortedIn.length/2)] : 0;
    
    const sortedOut = [...activeOutflows].sort((a,b) => a-b);
    const medOut = sortedOut.length > 0 ? sortedOut[Math.floor(sortedOut.length/2)] : 0;
    
    return {
        inflow: cvIn > 0.8 ? medIn : m5.inflow,
        outflow: cvOut > 0.8 ? medOut : m5.outflow
    };
}

interface RunResult {
    model: string;
    horizon: number;
    inflowPred: number;
    inflowActual: number;
    outflowPred: number;
    outflowActual: number;
}

function executeHarness() {
    const rawData = loadData();
    console.log(`Cleaned row count: ${rawData.length}`);
    
    // Filter out confirmed transfers for the main backtest
    const data = rawData.filter(r => !r.isConfirmedInternalTransfer);
    
    const earliestDate = startOfWeek(new Date(data[0].date), { weekStartsOn: 1 });
    const latestDate = new Date(data[data.length - 1].date);
    const totalWeeks = differenceInCalendarWeeks(latestDate, earliestDate, { weekStartsOn: 1 }) + 1;
    
    console.log(`Total complete weeks: ${totalWeeks}`);
    
    const trainingWeeks = 52;
    const horizonWeeks = 13;
    const totalOrigins = totalWeeks - trainingWeeks - horizonWeeks + 1;
    console.log(`Origins to test: ${totalOrigins}`);
    
    let results: RunResult[] = [];

    for (let o = 0; o < totalOrigins; o++) {
        const originStart = addWeeks(earliestDate, o);
        const originEnd = addWeeks(originStart, trainingWeeks);
        const horizonStart = originEnd;
        const horizonEnd = addWeeks(horizonStart, horizonWeeks);
        
        // Isolate training data
        const trainData = data.filter(r => new Date(r.date) >= originStart && new Date(r.date) < originEnd);
        // Isolate actuals
        const actualData = data.filter(r => new Date(r.date) >= horizonStart && new Date(r.date) < horizonEnd);
        
        // Build M1 tx format
        const txsForM1: BankTxForBaseline[] = trainData.map(r => ({
            amount: r.amount,
            date: new Date(r.date),
            merchantKey: r.name || r.memo || r.description || "Unknown"
        }));
        
        // M1
        const m1Res = computeBaseline(txsForM1, [], originEnd);
        
        // Build buckets for simple models
        const trainBuckets = getWeeklyBuckets(trainData, originStart, trainingWeeks);
        
        const m1aRes = computeM1A(trainBuckets);
        const m2Res = computeM2(trainBuckets);
        const m3Res = computeM3(trainBuckets);
        const m4Res = computeM4(trainBuckets);
        const m5Res = computeM5(trainBuckets);
        
        const models: { [key: string]: { inflow: number, outflow: number } } = {
            "M1": { inflow: m1Res.variableInflowWeekly, outflow: m1Res.variableOutflowWeekly },
            "M1A": m1aRes,
            "M2": m2Res,
            "M3": m3Res,
            "M4": m4Res,
            "M5": m5Res,
        };
        
        const actualBuckets = getWeeklyBuckets(actualData, horizonStart, horizonWeeks);
        
        for (let w = 0; w < horizonWeeks; w++) {
            const actIn = actualBuckets[w].inflow;
            const actOut = actualBuckets[w].outflow;
            
            for (const [mName, mPred] of Object.entries(models)) {
                results.push({
                    model: mName,
                    horizon: w + 1,
                    inflowPred: mPred.inflow,
                    inflowActual: actIn,
                    outflowPred: mPred.outflow,
                    outflowActual: actOut,
                });
            }
        }
    }
    
    fs.writeFileSync(path.join(__dirname, "../backtest_results.json"), JSON.stringify(results, null, 2));
    
    // Scoring
    const score = (modelResults: RunResult[], dir: "inflow" | "outflow") => {
        let errSum = 0;
        let sqErrSum = 0;
        let actSum = 0;
        let biasSum = 0;
        let maxMiss = 0;
        let dangerousCount = 0;
        let dangerousMagSum = 0;
        let n = modelResults.length;
        
        for (const r of modelResults) {
            const pred = dir === "inflow" ? r.inflowPred : r.outflowPred;
            const act = dir === "inflow" ? r.inflowActual : r.outflowActual;
            
            const err = pred - act;
            const absErr = Math.abs(err);
            
            errSum += absErr;
            sqErrSum += err * err;
            actSum += act;
            biasSum += err;
            if (absErr > maxMiss) maxMiss = absErr;
            
            // Dangerous: overpredict inflow or underpredict outflow
            const isDangerous = dir === "inflow" ? (pred > act) : (pred < act);
            if (isDangerous) {
                dangerousCount++;
                dangerousMagSum += absErr;
            }
        }
        
        return {
            MAE: errSum / n,
            RMSE: Math.sqrt(sqErrSum / n),
            WAPE: actSum > 0 ? errSum / actSum : 0,
            Bias: biasSum / n,
            BiasPct: actSum > 0 ? biasSum / actSum : 0,
            MaxMiss: maxMiss,
            DangerousFreq: n > 0 ? dangerousCount / n : 0,
            DangerousMag: dangerousCount > 0 ? dangerousMagSum / dangerousCount : 0
        };
    };
    
    for (const mName of ["M1", "M1A", "M2", "M3", "M4", "M5"]) {
        const mRes = results.filter(r => r.model === mName);
        const mResW14 = mRes.filter(r => r.horizon <= 4);
        console.log(`\n=== MODEL: ${mName} ===`);
        
        console.log(`-- Horizon: Weeks 1-13 (Overall) --`);
        const inScore = score(mRes, "inflow");
        const outScore = score(mRes, "outflow");
        console.log(`INFLOW : MAE=${inScore.MAE.toFixed(0)}, RMSE=${inScore.RMSE.toFixed(0)}, WAPE=${(inScore.WAPE*100).toFixed(1)}%, Bias=${inScore.Bias.toFixed(0)} (${(inScore.BiasPct*100).toFixed(1)}%), DangerFreq=${(inScore.DangerousFreq*100).toFixed(1)}%, DangerMag=${inScore.DangerousMag.toFixed(0)}, MaxMiss=${inScore.MaxMiss.toFixed(0)}`);
        console.log(`OUTFLOW: MAE=${outScore.MAE.toFixed(0)}, RMSE=${outScore.RMSE.toFixed(0)}, WAPE=${(outScore.WAPE*100).toFixed(1)}%, Bias=${outScore.Bias.toFixed(0)} (${(outScore.BiasPct*100).toFixed(1)}%), DangerFreq=${(outScore.DangerousFreq*100).toFixed(1)}%, DangerMag=${outScore.DangerousMag.toFixed(0)}, MaxMiss=${outScore.MaxMiss.toFixed(0)}`);
        
        console.log(`-- Horizon: Weeks 1-4 (Short Term) --`);
        const inScoreW4 = score(mResW14, "inflow");
        const outScoreW4 = score(mResW14, "outflow");
        console.log(`INFLOW : MAE=${inScoreW4.MAE.toFixed(0)}, RMSE=${inScoreW4.RMSE.toFixed(0)}, WAPE=${(inScoreW4.WAPE*100).toFixed(1)}%, Bias=${inScoreW4.Bias.toFixed(0)} (${(inScoreW4.BiasPct*100).toFixed(1)}%), DangerFreq=${(inScoreW4.DangerousFreq*100).toFixed(1)}%, DangerMag=${inScoreW4.DangerousMag.toFixed(0)}, MaxMiss=${inScoreW4.MaxMiss.toFixed(0)}`);
        console.log(`OUTFLOW: MAE=${outScoreW4.MAE.toFixed(0)}, RMSE=${outScoreW4.RMSE.toFixed(0)}, WAPE=${(outScoreW4.WAPE*100).toFixed(1)}%, Bias=${outScoreW4.Bias.toFixed(0)} (${(outScoreW4.BiasPct*100).toFixed(1)}%), DangerFreq=${(outScoreW4.DangerousFreq*100).toFixed(1)}%, DangerMag=${outScoreW4.DangerousMag.toFixed(0)}, MaxMiss=${outScoreW4.MaxMiss.toFixed(0)}`);
    }
}

executeHarness();
