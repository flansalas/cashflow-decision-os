import prisma from "../src/db/prisma";
import { assembleForecastData } from "../src/services/forecast-assembly";
import { computeForecast } from "../src/services/forecast";

async function main() {
    const cid = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
    const { input, baseline, overrides } = await assembleForecastData(cid);
    const forecast = computeForecast(input);
    
    // We can see variance multipliers in input if they were applied correctly.
    // wait, input.baselineInflowWeekly is post-multiplier.
    // raw M1 is baseline.variableInflowWeekly.
    const rawInflow = baseline.variableInflowWeekly;
    const rawOutflow = baseline.variableOutflowWeekly;
    const postInflow = input.baselineInflowWeekly;
    const postOutflow = input.variableOutflowWeekly;
    const inflowMult = rawInflow ? postInflow / rawInflow : 1.0;
    const outflowMult = rawOutflow ? postOutflow / rawOutflow : 1.0;
    
    console.log(JSON.stringify({
        deploymentSha: "e635048",
        inflowMultiplier: inflowMult,
        outflowMultiplier: outflowMult,
        rawM1InflowBaseline: rawInflow,
        rawM1OutflowBaseline: rawOutflow,
        postMultiplierInflow: postInflow,
        postMultiplierOutflow: postOutflow,
        week1: {
            startCash: forecast.weeks[0].startCash,
            expectedInflow: forecast.weeks[0].inflowsExpected,
            expectedOutflow: forecast.weeks[0].outflowsExpected,
            endCash: forecast.weeks[0].endCashExpected
        },
        week13EndCash: forecast.weeks[12].endCashExpected
    }, null, 2));
}
main().catch(console.error).finally(() => process.exit(0));
