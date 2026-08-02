import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";
import { differenceInDays, differenceInCalendarWeeks, startOfWeek, endOfWeek } from "date-fns";

const TARGET_ACCOUNTS = [
    "0050 UB - 0446 (Spending)",
    "0060 UB - 7085 (Holding)",
    "0070 UB - 3740 (Payroll)",
    "Petty Cash"
];

interface QBRow {
    date: Date;
    type: string;
    num: string;
    name: string;
    description: string;
    amount: number;
    balance: number;
    credit: number | null;
    debit: number | null;
    memo: string;
    split: string;
    account: string;
    rowNum: number;
}

function parseAmount(val: string | undefined): number | null {
    if (!val) return null;
    // Remove quotes and commas
    const clean = val.replace(/["',]/g, "").trim();
    if (clean === "") return null;
    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
}

function runValidator(filePath: string) {
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const parsed = Papa.parse(fileContent, { skipEmptyLines: true });
    
    let currentAccount: string | null = null;
    const allRows: QBRow[] = [];
    const accountsFound = new Set<string>();

    for (let i = 0; i < parsed.data.length; i++) {
        const cols: any = parsed.data[i];
        if (!cols || cols.length === 0) continue;
        
        // The first column is often empty for data rows, but let's check the first non-empty column
        const firstCol = cols[0];
        
        // Check if the row is an account header (first column has text, rest are mostly empty)
        if (firstCol && firstCol.match && firstCol.match(/^[a-zA-Z0-9]/) && cols[1] === "" && cols[2] === "" && !firstCol.startsWith("Total for") && !firstCol.startsWith("Transaction") && !firstCol.startsWith("Accrual")) {
            currentAccount = String(firstCol.trim());
            accountsFound.add(currentAccount);
            continue;
        }

        if (firstCol && firstCol.startsWith("Total for")) {
            currentAccount = null;
            continue;
        }

        if (currentAccount !== null && TARGET_ACCOUNTS.includes(currentAccount as string)) {
            // Data rows typically have an empty first column and Date in second column
            if (cols.length >= 11 && (cols[0] === "" || cols[0] === null)) {
                const dateStr = cols[1];
                if (!dateStr || dateStr === "Transaction date") continue;

                const dateObj = new Date(dateStr);
                if (isNaN(dateObj.getTime())) continue;

                const row: QBRow = {
                    date: dateObj,
                    type: String(cols[2] || ""),
                    num: String(cols[3] || ""),
                    name: String(cols[4] || ""),
                    description: String(cols[5] || ""),
                    amount: parseAmount(cols[6]) || 0,
                    balance: parseAmount(cols[7]) || 0,
                    credit: parseAmount(cols[8]),
                    debit: parseAmount(cols[9]),
                    memo: String(cols[10] || ""),
                    split: String(cols[11] || ""),
                    account: currentAccount,
                    rowNum: i + 1
                };
                allRows.push(row);
            }
        }
    }

    console.log("==================================================");
    console.log("= QUICKBOOKS OFFLINE FILE VALIDATION REPORT      =");
    console.log("==================================================");

    // 1. Identify and isolate only the actual cash accounts
    console.log(`Detected Accounts in Report: ${Array.from(accountsFound).join(", ")}`);
    const missingAccounts = TARGET_ACCOUNTS.filter(a => !accountsFound.has(a));
    if (missingAccounts.length > 0) {
        console.log(`WARNING: Missing Target Cash Accounts: ${missingAccounts.join(", ")}`);
    } else {
        console.log(`SUCCESS: All target cash accounts found.`);
    }
    
    // Sort rows by date
    allRows.sort((a, b) => a.date.getTime() - b.date.getTime());
    
    if (allRows.length === 0) {
        console.log("ERROR: No valid transactions found for the target cash accounts.");
        return;
    }

    const earliestDate = allRows[0].date;
    const latestDate = allRows[allRows.length - 1].date;

    const firstMonday = startOfWeek(earliestDate, { weekStartsOn: 1 });
    const lastSunday = endOfWeek(latestDate, { weekStartsOn: 1 });
    const totalCompleteCalendarWeeks = differenceInCalendarWeeks(lastSunday, firstMonday, { weekStartsOn: 1 });

    console.log(`\nDate Range: ${earliestDate.toISOString().split("T")[0]} to ${latestDate.toISOString().split("T")[0]}`);
    console.log(`Total Complete Weeks: ${totalCompleteCalendarWeeks} (Monday-starting)`);

    // Usable origins
    const getOrigins = (trainingWks: number) => {
        const origins = totalCompleteCalendarWeeks - trainingWks - 13 + 1;
        return origins > 0 ? origins : 0;
    };
    
    console.log(`\n--- Usable 13-Week Rolling Origins ---`);
    console.log(`12-Week Window Model    : ${getOrigins(12)} origins`);
    console.log(`26-Week Window Model    : ${getOrigins(26)} origins`);
    console.log(`52-Week Mature Model    : ${getOrigins(52)} origins`);

    // Duplicate risk
    const duplicateGroups: { [key: string]: QBRow[] } = {};
    allRows.forEach(r => {
        const key = `${r.account}_${r.date.toISOString().split('T')[0]}_${r.amount}_${r.name.trim()}_${r.memo.trim()}`;
        if (!duplicateGroups[key]) duplicateGroups[key] = [];
        duplicateGroups[key].push(r);
    });
    const exactDuplicates = Object.values(duplicateGroups).filter(rows => rows.length > 1);
    console.log(`\n--- Duplicate Risk ---`);
    console.log(`Exact Duplicates        : ${exactDuplicates.length} groups detected within bank account sections`);
    
    exactDuplicates.forEach((group, index) => {
        console.log(`\nDuplicate Group ${index + 1}:`);
        group.forEach(r => {
            console.log(`  Row ${r.rowNum} | Account: ${r.account} | Date: ${r.date.toISOString().split('T')[0]} | Type: ${r.type} | Amount: ${r.amount} | Num: ${r.num} | Name: ${r.name} | Memo: ${r.memo} | Balance Effect: ${r.amount}`);
        });
    });

    // Internal Transfers
    console.log(`\n--- Internal Transfers ---`);
    const transfers = allRows.filter(r => r.type.toLowerCase() === "transfer" || r.split.includes("UB -") || r.split.includes("Petty Cash"));
    const transferIn = transfers.filter(r => r.amount > 0);
    const transferOut = transfers.filter(r => r.amount < 0);
    
    let matchedPairs = 0;
    let usedOut = new Set<number>();
    const confirmedTransferRows = new Set<number>();
    
    transferIn.forEach((tin) => {
        const matchingIdx = transferOut.findIndex((tout, idx) => {
            if (usedOut.has(idx)) return false;
            if (Math.abs(tin.amount + tout.amount) > 0.01) return false;
            if (Math.abs(differenceInDays(tin.date, tout.date)) > 3) return false;
            return true;
        });
        
        if (matchingIdx !== -1) {
            matchedPairs++;
            usedOut.add(matchingIdx);
            confirmedTransferRows.add(tin.rowNum);
            confirmedTransferRows.add(transferOut[matchingIdx].rowNum);
        }
    });

    const totalTransfers = transferIn.length + transferOut.length;
    console.log(`Identified transfer rows: ${totalTransfers}`);
    console.log(`Matched transfer pairs  : ${matchedPairs} pairs (${matchedPairs * 2} rows)`);
    console.log(`Unmatched transfer rows : ${totalTransfers - matchedPairs * 2}`);

    // Consistent Sign Assessment
    let signErrors = 0;
    allRows.forEach(r => {
        // Typically Amount = Credit - Debit in QB, or depends on account type.
        // For Bank: Deposit = positive, Check/Payment = negative.
        // In QB export: Amount is positive for deposits, negative for payments.
        // Let's check if (credit > 0 && amount > 0) or (debit > 0 && amount < 0) or similar.
        // Actually QB puts positive numbers in Credit for Liability, but for Bank, Deposit is Debit (wait, no. In QB detail reports:
        // For Bank accounts, Increase is Debit, Decrease is Credit.
        // But the "Amount" column usually represents the natural sign: positive for increase, negative for decrease.
        // Let's verify this.
        if (r.credit && r.credit > 0 && r.amount > 0) {
            // A credit to a bank account should decrease it. If amount > 0, sign is inconsistent.
            signErrors++;
        }
        if (r.debit && r.debit > 0 && r.amount < 0) {
            // A debit to a bank account increases it. If amount < 0, sign is inconsistent.
            signErrors++;
        }
    });
    console.log(`\n--- Sign Convention ---`);
    console.log(`Sign inconsistencies detected: ${signErrors} (Checking if Amount aligns with Debit/Credit for Bank Accounts)`);
    console.log(`Note: QuickBooks usually makes Amount positive for Deposits and negative for Payments.`);

    // Running Balance Verification
    console.log(`\n--- Running Balance Verification ---`);
    let balanceErrors = 0;
    TARGET_ACCOUNTS.forEach(account => {
        const accountRows = allRows.filter(r => r.account === account);
        if (accountRows.length === 0) return;
        
        accountRows.sort((a, b) => a.rowNum - b.rowNum);
        
        for (let i = 1; i < accountRows.length; i++) {
            const expected = accountRows[i - 1].balance + accountRows[i].amount;
            const diff = Math.abs(expected - accountRows[i].balance);
            if (diff > 0.05) {
                balanceErrors++;
                console.log(`Discrepancy found in ${account} on ${accountRows[i].date.toISOString().split('T')[0]}: Row ${accountRows[i].rowNum}`);
                console.log(`  Expected Balance: ${expected.toFixed(2)} | Reported Balance: ${accountRows[i].balance.toFixed(2)} | Difference: ${(accountRows[i].balance - expected).toFixed(2)}`);
                
                // Check EOD balance
                const dateRows = accountRows.filter(r => r.date.getTime() === accountRows[i].date.getTime());
                const lastRowOfDay = dateRows[dateRows.length - 1];
                const expectedEOD = dateRows.reduce((sum, r) => sum + r.amount, accountRows.find(r => r.rowNum === dateRows[0].rowNum - 1)?.balance || 0);
                console.log(`  EOD Aggregate Expected: ${expectedEOD.toFixed(2)} | EOD Reported: ${lastRowOfDay.balance.toFixed(2)}`);
            }
        }
    });
    console.log(`Running balance discrepancies: ${balanceErrors}`);
    if (balanceErrors > 0) {
        console.log(`WARNING: The running balance in the report does not match the sum of amounts. This may happen if the report is filtered or if sorting changed.`);
    }

    console.log("==================================================");

    // Freeze dataset
    const frozenData = allRows.map(r => ({
        sourceRow: r.rowNum,
        account: r.account,
        date: r.date.toISOString().split('T')[0],
        type: r.type,
        num: r.num,
        name: r.name,
        description: r.description,
        amount: r.amount,
        balance: r.balance,
        isConfirmedInternalTransfer: confirmedTransferRows.has(r.rowNum),
        duplicateReviewStatus: exactDuplicates.some(g => g.some(dr => dr.rowNum === r.rowNum)) ? 'unresolved' : 'unique',
        memo: r.memo,
        split: r.split
    }));
    
    const outPath = path.join(path.dirname(filePath), "frozen_backtest_dataset.json");
    fs.writeFileSync(outPath, JSON.stringify(frozenData, null, 2));
    console.log(`Frozen dataset saved to ${outPath}`);
}

const targetPath = process.argv[2];
if (targetPath) {
    runValidator(targetPath);
} else {
    console.error("Please provide the path to the QB report CSV.");
}
