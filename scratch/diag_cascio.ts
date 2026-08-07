import prisma from "../src/db/prisma";
import { assembleForecastData } from "../src/services/forecast-assembly";
import { computeForecast } from "../src/services/forecast";

async function main() {
    const cid = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
    const { input } = await assembleForecastData(cid);
    const forecast = computeForecast(input);
    
    console.log(JSON.stringify(forecast.weeks[0].breakdown.inflows, null, 2));
}
main().catch(console.error).finally(() => process.exit(0));
