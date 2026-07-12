import { readFileSync } from 'fs';
import { join } from 'path';

const pagesToCheck = [
    'src/app/sources/page.tsx',
    'src/app/settings/page.tsx',
    'src/app/scenarios/page.tsx'
];

let failed = false;

for (const page of pagesToCheck) {
    const content = readFileSync(join(process.cwd(), page), 'utf-8');
    if (content.includes('data.companyId')) {
        console.error(`❌ Verification failed: ${page} still contains data.companyId`);
        failed = true;
    } else if (content.includes('data?.companyId')) {
        console.error(`❌ Verification failed: ${page} still contains data?.companyId`);
        failed = true;
    } else if (content.includes('data.company?.id') || content.includes('data?.company?.id')) {
        console.log(`✅ Verification passed: ${page} uses data.company.id`);
    } else {
        console.error(`⚠️ Warning: ${page} does not seem to contain company ID logic`);
    }
}

if (failed) {
    process.exit(1);
} else {
    console.log('All checked pages correctly use data.company.id');
}
