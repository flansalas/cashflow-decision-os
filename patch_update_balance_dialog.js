const fs = require('fs');
let code = fs.readFileSync('src/ui/UpdateBalanceDialog.tsx', 'utf8');

code = code.replace(
    'executionPlanId: executionPlanId,',
    ''
);

fs.writeFileSync('src/ui/UpdateBalanceDialog.tsx', code);
