import prisma from "@/db/prisma";
import { computeBaseline, BankTxForBaseline, RecurringPatternForBaseline } from "./baseline";
import { computeAIBaseline } from "./ai-baseline";

export async function buildAndCacheBaseline(companyId: string) {
    const bankTxs = await prisma.bankTransaction.findMany({
        where: { companyId },
        select: { amount: true, txDate: true, description: true, direction: true },
        orderBy: { txDate: "asc" }
    });

    const recurringPatternsRaw = await prisma.recurringPattern.findMany({
        where: { companyId, status: "active" },
    });

    const cashSnapshot = await prisma.cashSnapshot.findFirst({
        where: { companyId },
        orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }],
    });

    const assumptionsRaw = await prisma.assumption.findFirst({
        where: { companyId },
    });

    // --- Dynamic DSO Calculation ---
    // 1. Get total open AR
    const openInvoices = await prisma.receivableInvoice.findMany({
        where: { companyId, status: "open" },
        select: { amountOpen: true }
    });
    const totalOpenAR = openInvoices.reduce((sum, inv) => sum + inv.amountOpen, 0);

    // 2. Get 90-day cash inflows
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const ninetyDayInflows = bankTxs
        .filter(tx => tx.direction === "inflow" && tx.txDate >= ninetyDaysAgo)
        .reduce((sum, tx) => sum + tx.amount, 0);

    // 3. Calculate DSO and Delay Weeks
    const dso = (totalOpenAR / Math.max(1, ninetyDayInflows)) * 90;
    const dynamicDelayWeeks = Math.min(12, Math.max(1, Math.round(dso / 7)));
    console.log(`[DSO] ${companyId}: Open AR = $${totalOpenAR}, 90d Inflows = $${ninetyDayInflows}, DSO = ${dso.toFixed(1)} days -> ${dynamicDelayWeeks} weeks delay`);
    // -------------------------------

    const assumptions = assumptionsRaw ?? {
        payrollAllInAmount: null,
        payrollNextDate: null,
        payrollCadence: "biweekly",
        rentMonthlyAmount: null,
        rentDayOfMonth: null,
    };

    const bankTxsForBaseline: BankTxForBaseline[] = bankTxs.map(tx => ({
        amount: tx.amount,
        date: tx.txDate,
        merchantKey: tx.description ?? "",
    }));

    const patternsForBaseline: RecurringPatternForBaseline[] = recurringPatternsRaw.map(rp => ({
        merchantKey: rp.merchantKey ?? rp.displayName,
        direction: rp.direction,
        category: rp.category,
        isIncluded: rp.isIncluded,
        typicalAmount: rp.typicalAmount,
        amountStdDev: rp.amountStdDev,
        cadence: rp.cadence as any,
    }));

    const asOfDate = cashSnapshot?.asOfDate ?? new Date();

    const baseline = computeBaseline(bankTxsForBaseline, patternsForBaseline, asOfDate, {
        payrollAllInAmount: assumptions.payrollAllInAmount,
        payrollNextDate: assumptions.payrollNextDate,
        payrollCadence: assumptions.payrollCadence,
        rentMonthlyAmount: assumptions.rentMonthlyAmount,
        rentDayOfMonth: assumptions.rentDayOfMonth,
    });

    const aiBaseline = await computeAIBaseline(
        companyId,
        baseline.variableInflowWeekly,
        baseline.variableOutflowWeekly,
        (assumptions as any).paymentCurveJson || '{"current":0,"1-14":1,"15-30":2,"31-60":3,"61+":4}',
        dynamicDelayWeeks
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
        updatePayload.aiGeneratedAt = new Date();
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
            aiGeneratedAt: aiBaseline ? new Date() : null,
        }
    });
}
