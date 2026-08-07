import { PrismaClient } from '@prisma/client';
import { computeForecast } from '../src/services/forecast';
import { fetchDashboardDataForCompany } from '../src/services/dashboard';
import { buildForecastInput } from '../src/services/forecast-input-builder';
import { fetchTenantDataForForecast } from '../src/services/forecast-data';

const prisma = new PrismaClient();

async function main() {
    const data = await fetchTenantDataForForecast(prisma, '1a7b36f5-8fe0-4c2b-9336-8420846270b5');
    const input = buildForecastInput(data);
    const result = computeForecast(input);
    console.log('=== 13 WEEK FORECAST ===');
    result.weeks.forEach((w, i) => {
        console.log(`Week ${i+1} (${w.startDate.toISOString().slice(0, 10)}): Start: ${w.startCash.toFixed(2)}, In: ${w.inflowsExpected.toFixed(2)}, Out: ${w.outflowsExpected.toFixed(2)}, End: ${w.endCashExpected.toFixed(2)}, Best: ${w.bestCaseEnd.toFixed(2)}, Worst: ${w.worstCaseEnd.toFixed(2)}`);
    });
}
main().finally(() => prisma.$disconnect());
