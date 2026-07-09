const fs = require('fs');
let code = fs.readFileSync('src/app/api/review/route.ts', 'utf8');

// Remove computeBaseline import and usage
code = code.replace(
    'import { computeBaseline } from "@/services/baseline";\n',
    ''
);

code = code.replace(
    /const baselineResult = await computeBaseline\(companyId\);[\s\S]*?const lastUpdated = baselineResult\.cash\.asOfDate;/m,
    `const [cashSnapshot, adjustments] = await Promise.all([
            prisma.cashSnapshot.findFirst({ where: { companyId }, orderBy: { asOfDate: "desc" } }),
            prisma.cashAdjustment.findMany({ where: { companyId } })
        ]);
        const cash = {
            bankBalance: cashSnapshot?.bankBalance || 0,
            adjustments: adjustments.map(a => ({ type: a.type, amount: a.amount, note: a.note }))
        };
        const lastUpdated = cashSnapshot?.asOfDate ? cashSnapshot.asOfDate.toISOString() : null;`
);

fs.writeFileSync('src/app/api/review/route.ts', code);
