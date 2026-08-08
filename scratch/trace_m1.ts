import "dotenv/config";
import { assembleForecastData } from "@/services/forecast-assembly";
import prisma from "@/db/prisma";

async function run() {
    const cid = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
    const baseline = await prisma.baselineSnapshot.findUnique({ where: { companyId: cid } });
    console.log("Raw Baseline:", JSON.stringify(baseline, null, 2));

    const { forecastResult: forecast } = await assembleForecastData(cid);

    const week = forecast.weeks.find((w: any) => 
        Math.abs(w.inflowsExpected - 93863) < 100
    );

    if (!week) {
        console.log("Week not found. Printing all weeks summary:");
        forecast.weeks.forEach((w: any) => {
            console.log(w.weekStart, "Inflow:", w.inflowsExpected, "Outflow:", w.outflowsExpected);
        });
        return;
    }

    console.log("\nFound Representative Week:", week.weekStart);
    console.log("1. Raw M1 inflow:", baseline?.baselineInflow);
    console.log("2. Raw M1 outflow:", baseline?.baselineOutflow);
    console.log("3. Variance multiplier inflow:", baseline?.inflowVarianceMultiplier);
    console.log("3. Variance multiplier outflow:", baseline?.outflowVarianceMultiplier);
    console.log("4. Post-variance inflow:", (baseline?.baselineInflow || 0) * (baseline?.inflowVarianceMultiplier || 1));
    console.log("4. Post-variance outflow:", (baseline?.baselineOutflow || 0) * (baseline?.outflowVarianceMultiplier || 1));
    console.log("5. AI factor/adjustment inflow/outflow:", baseline?.aiInflowFactor, baseline?.aiOutflowFactor);
    
    // Now let's calculate what forecast-assembly does internally
    const postAIInflow = (baseline?.baselineInflow || 0) * (baseline?.inflowVarianceMultiplier || 1) * (baseline?.aiInflowFactor || 1);
    const postAIOutflow = (baseline?.baselineOutflow || 0) * (baseline?.outflowVarianceMultiplier || 1) * (baseline?.aiOutflowFactor || 1);
    console.log("6. Post-AI amounts:", { inflow: postAIInflow, outflow: postAIOutflow });

    console.log("7. Explicit coverage deductions:");
    console.log("   (Look at breakdown instead)");

    console.log("8. Resulting residual baseline shown in UI:");
    const residualInflow = week.breakdown.inflows.find((i: any) => i.section === "Baseline Inflow" || i.label.toLowerCase().includes("baseline"));
    const residualOutflow = week.breakdown.outflows.find((o: any) => o.section === "Baseline Outflow" || o.label.toLowerCase().includes("baseline") || o.label.toLowerCase().includes("residual") || o.label.toLowerCase().includes("projected") || o.label.toLowerCase().includes("variable"));
    console.log("   - Residual Inflow:", residualInflow);
    console.log("   - Residual Outflow:", residualOutflow);

    console.log("9. Final expected inflow/outflow for that week:");
    console.log("   - Total Inflow:", week.inflowsExpected);
    console.log("   - Total Outflow:", week.outflowsExpected);
    
    console.log("\nFull Outflow Breakdown:");
    console.log(JSON.stringify(week.breakdown.outflows, null, 2));
}
run().catch(console.error);
