const fs = require('fs');
let code = fs.readFileSync('src/ui/UpdateBalanceDialog.tsx', 'utf8');

code = code.replace(
    /body: JSON\.stringify\(\{\n                    companyId,\n                    bankBalance: parsedBalance,/g,
    `body: JSON.stringify({
                    companyId,
                    executionPlanId,
                    bankBalance: parsedBalance,`
);

fs.writeFileSync('src/ui/UpdateBalanceDialog.tsx', code);
