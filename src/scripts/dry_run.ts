import fs from "fs";
import path from "path";
import { computeBaseline, BankTxForBaseline } from "../services/baseline";

async function main() {
    const rawData = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scratch/frozen_backtest_dataset.json"), "utf-8"));
    
    const txs: BankTxForBaseline[] = rawData.map((row: any) => ({
        amount: parseFloat(row.Amount || row.amount),
        date: new Date(row.Date || row.date),
        merchantKey: row.Description || row.description || "Unknown"
    }));

    const asOfDate = new Date("2026-07-31T00:00:00Z");
    
    const baseline = computeBaseline(txs, [], asOfDate, {
        payrollAllInAmount: null,
        payrollNextDate: null,
        payrollCadence: "biweekly",
        rentMonthlyAmount: null,
        rentDayOfMonth: null
    });

    console.log("Dry Run Baseline Results:");
    console.log(`Variable Inflow Weekly: $${baseline.variableInflowWeekly.toFixed(2)}`);
    console.log(`Variable Outflow Weekly: $${baseline.variableOutflowWeekly.toFixed(2)}`);
    console.log(`Has Sufficient History: ${baseline.hasSufficientHistory}`);
    console.log(`Confidence Tier: ${baseline.baselineConfidenceTier}`);
    console.log(`Note: ${baseline.note}`);
}

main().catch(console.error);
