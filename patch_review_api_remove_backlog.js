const fs = require('fs');
let code = fs.readFileSync('src/app/api/review/route.ts', 'utf8');

code = code.replace(
    /import \{ computeForecast \} from "@\/services\/forecast";\nimport \{ generateActions \} from "@\/services\/actions";/m,
    ''
);

code = code.replace(
    /\/\/ Get Backlog[\s\S]*?const backlog = actions\.filter\(a => a\.type === "AR_PAST_DUE" \|\| a\.type === "AP_PAST_DUE"\);/m,
    ''
);

code = code.replace(
    'cash,\n            backlog,',
    'cash,'
);

fs.writeFileSync('src/app/api/review/route.ts', code);
