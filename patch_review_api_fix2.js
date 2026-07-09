const fs = require('fs');
let code = fs.readFileSync('src/app/api/review/route.ts', 'utf8');

code = code.replace(
    'baselineResult.cash.bankBalance',
    'cashSnapshot?.bankBalance || 0'
);

fs.writeFileSync('src/app/api/review/route.ts', code);
