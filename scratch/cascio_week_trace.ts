import { assembleForecastData } from '../src/services/forecast-assembly';
import { prisma } from '../src/db/prisma';
import { computeForecast } from '../src/services/forecast';

async function run() {
    const companyId = '1a7b36f5-8fe0-4c2b-9336-8420846270b5'; // Cascio
    
    const snap = await prisma.cashSnapshot.findFirst({
        where: { companyId },
        orderBy: { asOfDate: 'desc' }
    });
    if (!snap) throw new Error("No cash snapshot found at all");
    const asOfDate = snap.asOfDate;
    
    // We MUST use the latest database data. So just call assemble
    const input = await assembleForecastData(companyId, asOfDate);
    const forecast = computeForecast(input, asOfDate);
    
    let targetWeek = -1;
    let targetAmount = -1;
    let baselineVarOutWeekly = 0;
    
    for (let w = 0; w < 13; w++) {
        const week = forecast.weeks[w];
        
        // The dashboard shows ~$98,502 for residual outflow. 
        // We look for the "Projected variable spend" item in that range, or just look for the highest one.
        const varSpend = week.outflowBreakdown.find(i => i.label.startsWith('Projected variable spend'));
        
        if (varSpend && varSpend.amount > 80000) { 
            console.log(`\n=== FOUND TARGET WEEK: Week ${w + 1} ===`);
            console.log(`Residual Outflow Component Amount: $${varSpend.amount.toFixed(2)}`);
            targetWeek = w;
            targetAmount = varSpend.amount;
            
            console.log("\n1. rawM1Outflow (input.variableOutflowWeekly before multiplier):");
            const rawM1Outflow = input.variableOutflowWeekly; 
            // Wait, input.variableOutflowWeekly already has the variance multiplier applied. 
            // Let's get the raw baseline directly
            const baseline = await prisma.baselineSnapshot.findFirst({
                where: { companyId },
                orderBy: { createdAt: 'desc' }
            });
            console.log(baseline?.variableOutflowWeekly);
            
            console.log("\n2. varianceMultiplier");
            const multipliers = await prisma.varianceLedger.aggregate({
                where: { companyId },
                _avg: { variancePctIn: true, variancePct: true }
            }).then(res => ({
                inflow: 1.0 + (res._avg.variancePctIn ?? 0),
                outflow: 1.0 + (res._avg.variancePct ?? 0),
            }));
            console.log("Inflow Variance:", multipliers.inflow);
            console.log("Outflow Variance:", multipliers.outflow);
            
            console.log("\n3. aiOutflowFactor");
            console.log(input.aiOutflowFactors?.[w] ?? 1.0);
            
            console.log("\n4. projectionSafetyMargin");
            console.log(input.assumptions.projectionSafetyMargin ?? 1.0);
            
            console.log("\n5. resulting outflowMultiplier");
            const spendFade = input.spendFadeFactor ?? 1.0;
            const safetyMargin = input.assumptions.projectionSafetyMargin ?? 1.0;
            const outflowMultiplier = spendFade * (2 - safetyMargin);
            console.log(outflowMultiplier);
            
            console.log("\n6. scheduledVariableOutflowSum");
            const scheduledVariableOutflowSum = week.outflowBreakdown
                .filter(i => {
                    if (["payroll", "recurring", "assumption", "manual"].includes(i.sourceType)) return false;
                    if (i.sourceType === "baseline") return false;
                    return true;
                })
                .reduce((s, i) => s + i.amount, 0);
            console.log(scheduledVariableOutflowSum);
            
            console.log("\n7. every component included in scheduledVariableOutflowSum");
            const components = week.outflowBreakdown.filter(i => {
                if (["payroll", "recurring", "assumption", "manual", "baseline"].includes(i.sourceType)) return false;
                return true;
            });
            console.dir(components, { depth: null });
            
            console.log("\n8. pipelineCoverageOut");
            const pipelineCoverageOut = Math.min(1.0, scheduledVariableOutflowSum / input.variableOutflowWeekly);
            console.log(pipelineCoverageOut);
            
            console.log("\n9. pendingCogs added for that week");
            console.log("0 (pendingCogs is calculated but never added to outflowBreakdown)");
            
            console.log("\n10. final baselineVarOutWeekly");
            baselineVarOutWeekly = input.variableOutflowWeekly * outflowMultiplier * (1 - pipelineCoverageOut);
            const aiFactor = input.aiOutflowFactors?.[w] ?? 1.0;
            const finalBaseline = baselineVarOutWeekly * aiFactor;
            console.log(finalBaseline);
            
            console.log("\n11. final displayed ~$98,502 component");
            console.log(varSpend.amount);
            
            break;
        }
    }
    
    if (targetWeek === -1) {
        console.log("Could not find a week with > 80k variable spend.");
        console.log("Let's dump all weeks' variable spend:");
        for (let w = 0; w < 13; w++) {
             const varSpend = forecast.weeks[w].outflowBreakdown.find(i => i.label.startsWith('Projected variable spend'));
             console.log(`Week ${w+1}: ${varSpend ? varSpend.amount : 'N/A'}`);
        }
    }
}

run().catch(console.error);
