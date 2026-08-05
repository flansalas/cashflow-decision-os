const fs = require('fs');

let content = fs.readFileSync('src/app/plan/page.tsx', 'utf-8');
content = content.replace(/fetchDashboard\(effectiveCompanyId\)/g, 'fetchDashboard()');
content = content.replace('    const searchParams = useSearchParams();\n    \n    const effectiveCompanyId = data?.company.id ?? null;', '    const effectiveCompanyId = data?.company.id ?? null;');

fs.writeFileSync('src/app/plan/page.tsx', content);
