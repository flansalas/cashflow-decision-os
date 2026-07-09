const fs = require('fs');
let code = fs.readFileSync('src/app/review/page.tsx', 'utf8');

code = code.replace(
    /weeks=\{data\?\.active\?\.latestForecast \? \[data\.active\.latestForecast\] : \[\] \|\| \[\]\}/g,
    'weeks={data?.active?.latestForecast ? [data.active.latestForecast] : []}'
);

fs.writeFileSync('src/app/review/page.tsx', code);
