const fs = require('fs');
let code = fs.readFileSync('src/app/api/review/route.ts', 'utf8');

if (!code.includes('computeBaseline')) {
    code = code.replace(
        'import { resolveTenant } from "@/lib/tenant";',
        'import { resolveTenant } from "@/lib/tenant";\nimport { computeBaseline } from "@/services/baseline";'
    );
}

// Add the cash retrieval
code = code.replace(
    '// Get Live Forecast',
    `
        // Get Cash state
        const baselineResult = await computeBaseline(companyId);
        const cash = {
            bankBalance: baselineResult.cash.bankBalance,
            adjustments: baselineResult.cash.adjustments
        };
        const lastUpdated = baselineResult.cash.asOfDate;

        // Get Live Forecast`
);

code = code.replace(
    'forecast // send full forecast down for UpdateBalanceDialog if it needs priorWeekData',
    'cash,\n            lastUpdated'
);

fs.writeFileSync('src/app/api/review/route.ts', code);
