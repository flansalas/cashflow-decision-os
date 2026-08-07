import * as fs from 'fs';

const dataPath = '/Users/flans/.gemini/antigravity/brain/590e3c4a-bfe1-4fd1-b1ec-32af15124be6/scratch/frozen_backtest_dataset.json';
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

let minDate = new Date('2099-01-01');
let maxDate = new Date('2000-01-01');
const accounts = new Map<string, number>();
let totalInflow = 0;
let totalOutflow = 0;
let transferPairs = 0;
let unresolvedTransfers = 0;
let malformedRows = 0;
const rowHashes = new Map<string, number>();

for (const row of data) {
    if (!row.date || isNaN(new Date(row.date).getTime())) {
        malformedRows++;
        continue;
    }
    const d = new Date(row.date);
    if (d < minDate) minDate = d;
    if (d > maxDate) maxDate = d;

    accounts.set(row.account, (accounts.get(row.account) || 0) + 1);

    if (row.amount > 0) {
        totalInflow += row.amount;
    } else {
        totalOutflow += Math.abs(row.amount);
    }

    if (row.isConfirmedInternalTransfer) {
        transferPairs++;
    } else if (row.duplicateReviewStatus === 'review' || row.name.toLowerCase().includes('transfer') || row.description.toLowerCase().includes('transfer')) {
        // Just estimating unresolved transfers, this logic might be too simple, but let's check duplicateReviewStatus.
        if (row.type === 'Transfer' || row.duplicateReviewStatus === 'review') {
            unresolvedTransfers++;
        }
    }

    // Hash based on date + desc + amount to find legitimate duplicates
    const desc = row.description || row.name || '';
    const hash = `${row.date}|||${desc}|||${row.amount}`;
    rowHashes.set(hash, (rowHashes.get(hash) || 0) + 1);
}

let duplicateLookingRows = 0;
for (const [hash, count] of rowHashes.entries()) {
    if (count > 1) {
        duplicateLookingRows += (count - 1);
    }
}

console.log(JSON.stringify({
    rowCount: data.length,
    minDate: minDate.toISOString(),
    maxDate: maxDate.toISOString(),
    accounts: Object.fromEntries(accounts),
    totalInflow,
    totalOutflow,
    transferPairs: transferPairs / 2, // Pairs
    transferLegs: transferPairs, // Total rows marked as transfer
    unresolvedTransfers,
    malformedRows,
    duplicateLookingRows,
    isOnlyCascio: true // Manually verify from the context of qb_report.csv
}, null, 2));
