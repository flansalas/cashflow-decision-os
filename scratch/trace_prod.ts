import { assembleForecastData } from "../src/services/forecast-assembly";
import { computeForecast } from "../src/services/forecast";

async function main() {
    const CASCIO_ID = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
    
    // The user requested to use the specific existing CashSnapshot (asOfDate = 2026-07-27, bankBalance = 138816)
    // assembleForecastData natively fetches the latest one for the company.
    const result = await assembleForecastData(CASCIO_ID);
    
    const input = result.input;
    const forecast = result.forecastResult;
    
    // To get the variance multipliers, we can reconstruct the math from forecast-assembly or look at the inputs.
    // The input variableOutflowWeekly = baseline.variableOutflowWeekly * outflowMultiplier.
    // Let's just calculate the multipliers by division if the baseline exists.
    const baseline = result.baseline;
    
    let inflowMultiplier = 1.0;
    let outflowMultiplier = 1.0;
    if (baseline) {
        if (baseline.variableInflowWeekly > 0) {
            inflowMultiplier = input.baselineInflowWeekly / baseline.variableInflowWeekly;
        }
        if (baseline.variableOutflowWeekly > 0) {
            outflowMultiplier = input.variableOutflowWeekly / baseline.variableOutflowWeekly;
        }
    }
    
    console.log(`raw M1 inflow = ${baseline?.variableInflowWeekly}`);
    console.log(`raw M1 outflow = ${baseline?.variableOutflowWeekly}`);
    console.log(`variance inflow multiplier = ${inflowMultiplier.toFixed(1)}`);
    console.log(`variance outflow multiplier = ${outflowMultiplier.toFixed(1)}`);
    console.log(`final input.baselineInflowWeekly = ${input.baselineInflowWeekly}`);
    console.log(`final input.variableOutflowWeekly = ${input.variableOutflowWeekly}`);
    
    const w1 = forecast.weeks[0];
    console.log(`\nWeek 1:`);
    console.log(`start cash = ${w1.startCash}`);
    console.log(`expected inflow = ${w1.inflowsExpected}`);
    console.log(`expected outflow = ${w1.outflowsExpected}`);
    console.log(`ending cash = ${w1.endCashExpected}`);
    console.log(`complete outflow breakdown by major component =`);
    for (const ob of w1.breakdown.outflows) {
        console.log(`  - ${ob.label} (${ob.sourceType}): ${ob.amount}`);
    }
    
    const w5 = forecast.weeks[4];
    console.log(`\nWeek 5:`);
    console.log(`expected inflow = ${w5.inflowsExpected}`);
    console.log(`expected outflow = ${w5.outflowsExpected}`);
    
    const w5residual = w5.breakdown.outflows.find(b => b.sourceType === "baseline_variable" || b.sourceType === "residual" || b.label.toLowerCase().includes("residual") || b.label.toLowerCase().includes("baseline"));
    console.log(`projected variable/residual outflow component = ${w5residual?.amount || 0}`);
    
    const w5payroll = w5.breakdown.outflows.find(b => b.sourceType === "assumption_payroll" || b.label.toLowerCase().includes("payroll"));
    console.log(`payroll = ${w5payroll?.amount || 0}`);
    
    const w5ap = w5.breakdown.outflows.filter(b => b.sourceType === "payable_bill").reduce((sum, b) => sum + b.amount, 0);
    console.log(`AP = ${w5ap}`);
    
    const w5rec = w5.breakdown.outflows.filter(b => b.sourceType === "recurring").reduce((sum, b) => sum + b.amount, 0);
    console.log(`recurring = ${w5rec}`);
    
    console.log(`other material components =`);
    for (const ob of w5.breakdown.outflows) {
        if (!["baseline_variable", "residual", "assumption_payroll", "payable_bill", "recurring"].includes(ob.sourceType) && !ob.label.toLowerCase().includes("payroll") && !ob.label.toLowerCase().includes("residual") && !ob.label.toLowerCase().includes("baseline")) {
            console.log(`  - ${ob.label} (${ob.sourceType}): ${ob.amount}`);
        }
    }
    
    const w8 = forecast.weeks[7];
    const w8residual = w8.breakdown.outflows.find(b => b.sourceType === "baseline_variable" || b.sourceType === "residual" || b.label.toLowerCase().includes("residual") || b.label.toLowerCase().includes("baseline"));
    console.log(`\nWeek 8 projected variable/residual outflow = ${w8residual?.amount || 0}`);
    
    const w13 = forecast.weeks[12];
    if (w13) {
        const w13residual = w13.breakdown.outflows.find(b => b.sourceType === "baseline_variable" || b.sourceType === "residual" || b.label.toLowerCase().includes("residual") || b.label.toLowerCase().includes("baseline"));
        console.log(`\nWeek 13:`);
        console.log(`expected inflow = ${w13.inflowsExpected}`);
        console.log(`expected outflow = ${w13.outflowsExpected}`);
        console.log(`projected variable/residual outflow = ${w13residual?.amount || 0}`);
        console.log(`ending cash = ${w13.endCashExpected}`);
    } else {
        console.log(`\nWeek 13 data missing (forecast length: ${forecast.weeks.length})`);
    }
    
    console.log(`\nPRODUCTION FORECAST TRACE COMPLETE`);
}

main().catch(e => {
    console.error(e);
    console.log("\nFAILED");
    process.exit(1);
});
