import { POST } from './src/app/api/cash-checkin/route';
import { NextRequest } from 'next/server';
import * as tenant from './src/lib/tenant';
(tenant as any).resolveTenant = async () => "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb";

async function run() {
    const req = new NextRequest("http://localhost/api/cash-checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            companyId: "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb",
            bankBalance: 50000,
            asOfDate: new Date().toISOString(),
            adjustments: [],
            priorWeekForecast: {
                forecastVersionHash: "client_observed_v1",
                generatedAt: new Date().toISOString(),
                weekStart: "2026-08-02T00:00:00Z",
                weekEnd: "2026-08-08T23:59:59Z",
                endCashExpected: 50000,
                inflowsExpected: 0,
                outflowsExpected: 0
            }
        })
    });

    try {
        const res = await POST(req);
        console.log("Status:", res.status);
        console.log("Body:", await res.text());
    } catch (e) {
        console.error("Error:", e);
    }
}

run();
