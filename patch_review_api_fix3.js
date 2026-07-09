const fs = require('fs');
let code = fs.readFileSync('src/app/api/review/route.ts', 'utf8');

code = code.replace(
    'prisma.invoice.findMany',
    'prisma.receivableInvoice.findMany'
);
code = code.replace(
    'prisma.bill.findMany',
    'prisma.payableBill.findMany'
);
code = code.replace(
    'prisma.recurringItem.findMany({ where: { companyId, isActive: true } })',
    'prisma.recurringPattern.findMany({ where: { companyId } })'
);

fs.writeFileSync('src/app/api/review/route.ts', code);
