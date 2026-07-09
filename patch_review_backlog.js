const fs = require('fs');
let code = fs.readFileSync('src/app/review/page.tsx', 'utf8');

// replace dashboardData.backlog with data.backlog
code = code.replace(
    /dashboardData\?\.backlog/g,
    'data?.backlog'
);
code = code.replace(
    /dashboardData\.backlog/g,
    'data.backlog'
);

code = code.replace(
    /data\.forecast\?\.forecastResult\?\.weeks/g,
    'data?.active?.latestForecast ? [data.active.latestForecast] : []'
);

fs.writeFileSync('src/app/review/page.tsx', code);
