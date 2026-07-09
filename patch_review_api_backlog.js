const fs = require('fs');
let code = fs.readFileSync('src/app/api/review/route.ts', 'utf8');

// We need to import computeForecast and generateActions from dashboard's dependencies.
// Actually, let's just use what dashboard uses.
if (!code.includes('generateActions')) {
    code = code.replace(
        'import { computeBaseline } from "@/services/baseline";',
        'import { computeBaseline } from "@/services/baseline";\nimport { computeForecast } from "@/services/forecast";\nimport { generateActions } from "@/services/actions";'
    );
}

if (!code.includes('const backlog = ')) {
    code = code.replace(
        '// Get Live Forecast',
        `// Get Backlog
        const invoices = await prisma.invoice.findMany({ where: { companyId } });
        const bills = await prisma.bill.findMany({ where: { companyId } });
        const recurrings = await prisma.recurringItem.findMany({ where: { companyId, isActive: true } });
        
        const forecastResult = computeForecast(
            companyId,
            { invoices, bills, recurrings },
            currentWeekStart,
            baselineResult.cash.bankBalance
        );
        const actions = generateActions(forecastResult);
        const backlog = actions.filter(a => a.type === "AR_PAST_DUE" || a.type === "AP_PAST_DUE");

        // Get Live Forecast`
    );
    
    code = code.replace(
        'cash,',
        'cash,\n            backlog,'
    );
}

fs.writeFileSync('src/app/api/review/route.ts', code);
