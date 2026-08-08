import { assembleForecastData } from '../src/services/forecast-assembly';
import { prisma } from '../src/db/prisma';
import { computeForecast } from '../src/services/forecast';

async function run() {
    const companyId = '1a7b36f5-8fe0-4c2b-9336-8420846270b5'; // Cascio
    
    const snap = await prisma.cashSnapshot.findFirst({
        where: { companyId },
        orderBy: { asOfDate: 'desc' }
    });
    const asOfDate = snap!.asOfDate;
    
    const baseline = await prisma.baselineSnapshot.findFirst({
        where: { companyId },
        orderBy: { createdAt: 'desc' }
    });

    const input = await assembleForecastData(companyId, asOfDate);
    const forecast = computeForecast(input, asOfDate);
    
    // We look for a later week (e.g. Week 8, which is index 7) to find the residual outflow.
    // The user mentioned ~$98,502 before. Now it should be different if the multiplier is 1.0!
    let targetWeek = 7;
    let targetAmount = -1;
    let varSpendComponent = null;

    for (let w = 0; w < 13; w++) {
        const week = forecast.weeks[w];
        const varSpend = week.outflowBreakdown.find((i: any) => i.label.startsWith('Projected variable spend'));
        if (varSpend && varSpend.amount > 0) {
            targetWeek = w;
            targetAmount = varSpend.amount;
            varSpendComponent = varSpend;
            if (w > 3) break; // find a later week
        }
    }

    if (targetWeek === -1) {
        console.log("No projected variable spend found in any week.");
        return;
    }

    console.log(`=== Week ${targetWeek + 1} Metrics ===`);
    
    const rawM1Outflow = baseline?.variableOutflowWeekly ?? 0;
    console.log(`1. rawM1Outflow: ${rawM1Outflow}`);
    
    const varianceMultiplier = input.variableOutflowWeekly / (rawM1Outflow || 1);
    console.log(`2. varianceMultiplier: ${varianceMultiplier}`);
    
    const aiOutflowFactor = input.aiOutflowFactors?.[targetWeek] ?? 1.0;
    console.log(`3. aiOutflowFactor: ${aiOutflowFactor}`);
    
    const projectionSafetyMargin = input.assumptions.projectionSafetyMargin ?? 1.0;
    console.log(`4. projectionSafetyMargin: ${projectionSafetyMargin}`);
    
    const spendFade = input.spendFadeFactor ?? 1.0;
    const outflowMultiplier = spendFade * (2 - projectionSafetyMargin);
    console.log(`5. resulting outflowMultiplier (spendFade * (2 - projectionSafetyMargin)): ${outflowMultiplier}`);
    
    const week = forecast.weeks[targetWeek];
    const scheduledVariableOutflowSum = week.outflowBreakdown
        .filter((i: any) => !["payroll", "recurring", "assumption", "manual", "baseline"].includes(i.sourceType))
        .reduce((s: number, i: any) => s + i.amount, 0);
    console.log(`6. scheduledVariableOutflowSum: ${scheduledVariableOutflowSum}`);
    
    console.log(`7. every component included in scheduledVariableOutflowSum:`);
    const components = week.outflowBreakdown.filter((i: any) => !["payroll", "recurring", "assumption", "manual", "baseline"].includes(i.sourceType));
    components.forEach((c: any) => console.log(`   - [${c.sourceType}] ${c.label}: ${c.amount}`));
    
    const pipelineCoverageOut = Math.min(1.0, scheduledVariableOutflowSum / input.variableOutflowWeekly);
    console.log(`8. pipelineCoverageOut: ${pipelineCoverageOut}`);
    
    console.log(`9. any pendingCogs added for that week: 0`);
    
    const baselineVarOutWeekly = input.variableOutflowWeekly * outflowMultiplier * (1 - pipelineCoverageOut);
    console.log(`10. final baselineVarOutWeekly: ${baselineVarOutWeekly}`);
    
    const finalDisplayed = baselineVarOutWeekly * aiOutflowFactor;
    console.log(`11. final displayed component: ${varSpendComponent?.amount} (calculated: ${finalDisplayed})`);

    console.log(`\nReconstruction:`);
    console.log(`baselineVarOutWeekly = (rawM1Outflow * varianceMultiplier) * outflowMultiplier * (1 - pipelineCoverageOut)`);
    console.log(`                     = (${rawM1Outflow} * ${varianceMultiplier}) * ${outflowMultiplier} * (1 - ${pipelineCoverageOut})`);
    console.log(`                     = ${input.variableOutflowWeekly} * ${outflowMultiplier} * ${(1 - pipelineCoverageOut)}`);
    console.log(`                     = ${baselineVarOutWeekly}`);
    console.log(`final = baselineVarOutWeekly * aiOutflowFactor`);
    console.log(`      = ${baselineVarOutWeekly} * ${aiOutflowFactor}`);
    console.log(`      = ${finalDisplayed}`);
}

run().catch(console.error);
