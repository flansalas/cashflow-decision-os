import * as fs from 'fs';
import * as path from 'path';

console.log("Starting forecast hash integrity static verification...");

function verify() {
    const codePath = path.join(__dirname, '../src/services/forecast-hash.ts');
    if (!fs.existsSync(codePath)) {
        console.error(`FAIL: File not found: ${codePath}`);
        process.exit(1);
    }
    
    const code = fs.readFileSync(codePath, 'utf-8');
    let failed = false;

    const checks = [
        { desc: "await assembleForecastData(companyId)", regex: /await\s+assembleForecastData\(\s*companyId\s*\)/ },
        { desc: "update only the specified ChangeLog record", regex: /where:\s*{\s*id:\s*changeLogId\s*}/ },
        { desc: "store the final forecastVersionHash on success", regex: /forecastVersionHashAfter:\s*newHash/ },
        { desc: "store 'error' on failure", regex: /forecastVersionHashAfter:\s*["']error["']/ },
        { desc: "never leave the record as 'pending'", regex: /catch\s*\([^)]*\)\s*{[\s\S]*forecastVersionHashAfter:\s*["']error["']/ },
    ];

    for (const check of checks) {
        if (!check.regex.test(code)) {
            console.error(`FAIL: Missing requirement: ${check.desc}`);
            failed = true;
        } else {
            console.log(`PASS: Found requirement: ${check.desc}`);
        }
    }

    if (code.includes('throw ')) {
        console.error('FAIL: Helper should not throw errors to preserve primary mutation.');
        failed = true;
    } else {
        console.log('PASS: Helper catches errors without throwing.');
    }

    if (failed) {
        console.error("\n❌ VERIFICATION FAILED");
        process.exit(1);
    } else {
        console.log("\n✅ VERIFICATION PASSED");
        process.exit(0);
    }
}

verify();
