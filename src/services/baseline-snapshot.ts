import prisma from "@/db/prisma";
import { computeBaseline, BankTxForBaseline, RecurringPatternForBaseline } from "./baseline";
import { computeAIBaseline } from "./ai-baseline";
import { getCanonicalBaselineInputs } from "./baseline-fetch";
import { getManagerialVisibility } from "./managerial-visibility";
export async function buildAndCacheBaseline(companyId: string) {
    const { bankTxsRaw, recurringPatternsRaw, bankTxsForBaseline, patternsForBaseline } = await getCanonicalBaselineInputs(companyId);
    
    // We will use bankTxsRaw for the DSO/DPO calculation below
    const bankTxs = bankTxsRaw;

    const [cashSnapshot, assumptionsRaw, visibility] = await Promise.all([
        prisma.cashSnapshot.findFirst({
            where: { companyId },
            orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }],
        }),
        prisma.assumption.findFirst({ where: { companyId } }),
        getManagerialVisibility(companyId),
    ]);

    // --- Dynamic DSO Calculation ---
    // 1. Get total open AR
    const openInvoices = await prisma.receivableInvoice.findMany({
        where: { companyId, status: "open", id: { notIn: [...visibility.hiddenInvoiceIds] } },
        select: { amountOpen: true }
    });
    const totalOpenAR = openInvoices.reduce((sum, inv) => sum + inv.amountOpen, 0);

    // 2. Get 90-day cash inflows
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const ninetyDayInflows = bankTxs
        .filter(tx => tx.direction === "inflow" && tx.txDate >= ninetyDaysAgo)
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    // 3. Calculate DSO and Inflow Delay Weeks
    const dso = (totalOpenAR / Math.max(1, ninetyDayInflows)) * 90;
    const inflowDelayWeeks = Math.min(12, Math.max(1, Math.round(dso / 7)));

    // --- Dynamic DPO Calculation ---
    // 1. Get total open AP
    const openBills = await prisma.payableBill.findMany({
        where: { companyId, status: "open", id: { notIn: [...visibility.hiddenBillIds] } },
        select: { amountOpen: true }
    });
    const totalOpenAP = openBills.reduce((sum, bill) => sum + bill.amountOpen, 0);

    // 2. Get 90-day cash outflows
    const ninetyDayOutflows = bankTxs
        .filter(tx => tx.direction === "outflow" && tx.txDate >= ninetyDaysAgo)
        .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

    // 3. Calculate DPO and Outflow Delay Weeks
    const dpo = (totalOpenAP / Math.max(1, ninetyDayOutflows)) * 90;
    const outflowDelayWeeks = Math.min(12, Math.max(1, Math.round(dpo / 7)));

    console.log(`[DSO/DPO] ${companyId}: DSO = ${dso.toFixed(1)} days (${inflowDelayWeeks}w), DPO = ${dpo.toFixed(1)} days (${outflowDelayWeeks}w)`);
    // -------------------------------

    const assumptions = assumptionsRaw ?? {
        payrollAllInAmount: null,
        payrollNextDate: null,
        payrollCadence: "biweekly",
        rentMonthlyAmount: null,
        rentDayOfMonth: null,
    };

    const asOfDate = cashSnapshot?.asOfDate ?? new Date();

    const baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, asOfDate, {
        payrollAllInAmount: assumptions.payrollAllInAmount,
        payrollNextDate: assumptions.payrollNextDate,
        payrollCadence: assumptions.payrollCadence,
        rentMonthlyAmount: assumptions.rentMonthlyAmount,
        rentDayOfMonth: assumptions.rentDayOfMonth,
    });

    const existingSnapshot = await prisma.baselineSnapshot.findUnique({
        where: { companyId }
    });

    if (!baseline.hasSufficientHistory && existingSnapshot?.hasSufficientHistory) {
        console.warn(`[DATA LOSS GUARD] Company ${companyId} lost sufficient history! Retaining previous snapshot and marking degraded.`);
        
        await prisma.changeLog.create({
            data: {
                companyId,
                source: "baseline-snapshot",
                action: "baseline_data_loss_detected",
                diffJson: JSON.stringify({ 
                    message: "Valid historical baseline was replaced by a zero placeholder due to missing bank transactions. Guard activated.",
                    previousSufficientHistory: true,
                    newSufficientHistory: false
                }),
                forecastVersionHashAfter: "degraded",
                forecastVersionHashBefore: existingSnapshot.baselineConfidenceTier,
            }
        });

        await prisma.baselineSnapshot.update({
            where: { companyId },
            data: {
                baselineConfidenceTier: "degraded_data_loss",
            }
        });
        
        return;
    }

    const aiBaseline = await computeAIBaseline(
        companyId,
        baseline.variableInflowWeekly,
        baseline.variableOutflowWeekly,
        (assumptions as any).paymentCurveJson || '{"current":0,"1-14":1,"15-30":2,"31-60":3,"61+":4}',
        inflowDelayWeeks,
        outflowDelayWeeks
    );

    const updatePayload: any = {
        asOfDate,
        hasSufficientHistory: baseline.hasSufficientHistory,
        baselineConfidenceTier: baseline.baselineConfidenceTier,
        inflowCadence: (baseline as any).inflowCadence?.toString() || "1",
        outflowCadence: (baseline as any).outflowCadence?.toString() || "1",
        variableInflowWeekly: baseline.variableInflowWeekly,
        variableOutflowWeekly: baseline.variableOutflowWeekly,
        variableInflowBand: baseline.variableInflowBand,
        variableOutflowBand: baseline.variableOutflowBand,
        conservativeInflowWeekly: baseline.conservativeInflowWeekly,
        conservativeOutflowWeekly: baseline.conservativeOutflowWeekly,
        weeklyBucketsJson: JSON.stringify(baseline.weeklyBuckets),
    };

    if (aiBaseline) {
        updatePayload.aiInflowFactorsJson = JSON.stringify(aiBaseline.inflowFactors);
        updatePayload.aiOutflowFactorsJson = JSON.stringify(aiBaseline.outflowFactors);
        updatePayload.aiInflowExplanationsJson = JSON.stringify(aiBaseline.inflowExplanations);
        updatePayload.aiOutflowExplanationsJson = JSON.stringify(aiBaseline.outflowExplanations);
        updatePayload.aiReasoningLogJson = aiBaseline.reasoningLog;
        
        updatePayload.weeklyInflowCoverageJson = JSON.stringify(aiBaseline.weeklyInflowCoverage);
        updatePayload.weeklyOutflowCoverageJson = JSON.stringify(aiBaseline.weeklyOutflowCoverage);
        updatePayload.evidenceStateJson = JSON.stringify(new Array(13).fill("UNKNOWN_INFLOW")); // Placeholder as requested: "do not alter production baseline factor logic"
        updatePayload.rawAiResponseJson = aiBaseline.rawAiResponse;
        updatePayload.promptVersionHash = aiBaseline.promptVersionHash;
        updatePayload.modelIdentifier = aiBaseline.modelIdentifier;
        
        updatePayload.aiGeneratedAt = new Date();
    } else {
        // AI failed (e.g. exception thrown). Neutralize to prevent stale factors remaining economically active.
        updatePayload.aiInflowFactorsJson = JSON.stringify(new Array(13).fill(1.0));
        updatePayload.aiOutflowFactorsJson = JSON.stringify(new Array(13).fill(1.0));
        updatePayload.aiInflowExplanationsJson = JSON.stringify(new Array(13).fill("AI Error: Generation failed. Fallback to deterministic."));
        updatePayload.aiOutflowExplanationsJson = JSON.stringify(new Array(13).fill("AI Error: Generation failed. Fallback to deterministic."));
        updatePayload.aiReasoningLogJson = "AI Generation Failed: Fallback to deterministic baseline.";
        
        updatePayload.weeklyInflowCoverageJson = JSON.stringify(new Array(13).fill(0));
        updatePayload.weeklyOutflowCoverageJson = JSON.stringify(new Array(13).fill(0));
        updatePayload.evidenceStateJson = JSON.stringify(new Array(13).fill("UNKNOWN_INFLOW"));
        updatePayload.rawAiResponseJson = "{}";
        updatePayload.promptVersionHash = "v1.0.0-fallback";
        updatePayload.modelIdentifier = "none";
        
        // We do NOT update aiGeneratedAt to preserve accurate audit metadata of the last *successful* generation
    }

    // Save BaselineSnapshot
    await prisma.baselineSnapshot.upsert({
        where: { companyId },
        update: updatePayload,
        create: {
            companyId,
            asOfDate,
            hasSufficientHistory: baseline.hasSufficientHistory,
            baselineConfidenceTier: baseline.baselineConfidenceTier,
            inflowCadence: (baseline as any).inflowCadence?.toString() || "1",
            outflowCadence: (baseline as any).outflowCadence?.toString() || "1",
            variableInflowWeekly: baseline.variableInflowWeekly,
            variableOutflowWeekly: baseline.variableOutflowWeekly,
            variableInflowBand: baseline.variableInflowBand,
            variableOutflowBand: baseline.variableOutflowBand,
            conservativeInflowWeekly: baseline.conservativeInflowWeekly,
            conservativeOutflowWeekly: baseline.conservativeOutflowWeekly,
            weeklyBucketsJson: JSON.stringify(baseline.weeklyBuckets),
            
            // AI Fields
            aiInflowFactorsJson: aiBaseline ? JSON.stringify(aiBaseline.inflowFactors) : null,
            aiOutflowFactorsJson: aiBaseline ? JSON.stringify(aiBaseline.outflowFactors) : null,
            aiInflowExplanationsJson: aiBaseline ? JSON.stringify(aiBaseline.inflowExplanations) : null,
            aiOutflowExplanationsJson: aiBaseline ? JSON.stringify(aiBaseline.outflowExplanations) : null,
            aiReasoningLogJson: aiBaseline ? aiBaseline.reasoningLog : null,
            
            weeklyInflowCoverageJson: aiBaseline ? JSON.stringify(aiBaseline.weeklyInflowCoverage) : null,
            weeklyOutflowCoverageJson: aiBaseline ? JSON.stringify(aiBaseline.weeklyOutflowCoverage) : null,
            evidenceStateJson: aiBaseline ? JSON.stringify(new Array(13).fill("UNKNOWN_INFLOW")) : null,
            rawAiResponseJson: aiBaseline ? aiBaseline.rawAiResponse : null,
            promptVersionHash: aiBaseline ? aiBaseline.promptVersionHash : null,
            modelIdentifier: aiBaseline ? aiBaseline.modelIdentifier : null,
            
            aiGeneratedAt: aiBaseline ? new Date() : null,
        }
    });
}
