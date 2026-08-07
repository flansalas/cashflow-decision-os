import prisma from "../src/db/prisma";
import { assembleForecastData } from "../src/services/forecast-assembly";
import { mondayBefore } from "../src/services/baseline-shared";

async function main() {
    const cid = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
    
    const { input, cashFlowEntries, cashAdjustments } = await assembleForecastData(cid);

    console.log("asOfDate:", input.asOfDate);
    const currentMonday = mondayBefore(input.asOfDate, 0);
    console.log("currentMonday:", currentMonday);
}

main().catch(console.error).finally(() => process.exit(0));
