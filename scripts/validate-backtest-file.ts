import * as fs from "fs";
import * as path from "path";
import XLSX from "xlsx";
import Papa from "papaparse";
import { parse, differenceInDays, startOfWeek, endOfWeek, differenceInCalendarWeeks } from "date-fns";

// DO NOT IMPORT FROM PRISMA - THIS MUST RUN COMPLETELY ISOLATED

interface BankRow {
    date: Date;
    amount: number;
    description: string;
    account?: string;
    rowNum: number;
}

export function validateBankFile(filePath: string) {
    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    const ext = path.extname(filePath).toLowerCase();
    let rows: BankRow[] = [];
    
    if (ext === ".csv") {
        const fileContent = fs.readFileSync(filePath, "utf-8");
        // Replace unicode replacement characters that might have been pasted
        const cleanContent = fileContent.replace(/\uFFFD/g, "");
        const results = Papa.parse(cleanContent, { header: true, skipEmptyLines: true });
        if (results.errors.length > 0) {
            // If the only error is TooManyFields due to a trailing comma in the header/data, we can proceed.
            const criticalErrors = results.errors.filter(e => e.code !== "TooManyFields");
            if (criticalErrors.length > 0) {
                console.error("CSV Parse Errors:", criticalErrors);
                process.exit(1);
            }
        }
        console.log(`Detected Columns: ${results.meta.fields?.join(", ")}`);
        rows = extractRows(results.data);
    } else if (ext === ".xlsx" || ext === ".xls") {
        const workbook = XLSX.readFile(filePath);
        console.log(`Worksheets inspected: ${workbook.SheetNames.join(", ")} (Using first sheet: ${workbook.SheetNames[0]})`);
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        if (data.length > 0) {
            console.log(`Detected Columns: ${Object.keys(data[0] as object).join(", ")}`);
        }
        rows = extractRows(data);
    } else {
        console.error("Unsupported file format. Please provide .csv, .xls, or .xlsx");
        process.exit(1);
    }

    if (rows.length === 0) {
        console.error("No valid transaction rows parsed. Check column names (Date, Amount, Description).");
        process.exit(1);
    }

    rows.sort((a, b) => a.date.getTime() - b.date.getTime());

    // 1. Completeness & Coverage Assessment
    const earliestDate = rows[0].date;
    const latestDate = rows[rows.length - 1].date;
    const totalDays = differenceInDays(latestDate, earliestDate) + 1;
    
    // We want Monday-starting weeks
    const firstMonday = startOfWeek(earliestDate, { weekStartsOn: 1 });
    const lastSunday = endOfWeek(latestDate, { weekStartsOn: 1 });
    const totalCompleteCalendarWeeks = differenceInCalendarWeeks(lastSunday, firstMonday, { weekStartsOn: 1 });

    const accountsFound = new Set(rows.map(r => r.account));
    let accountIdentificationStatus = accountsFound.size > 0 && !accountsFound.has("Unknown") 
        ? "Verified" : "Unverified (Accounts missing or unlabeled)";

    let gaps: { start: Date; end: Date; days: number }[] = [];
    let maxGap = 0;
    for (let i = 1; i < rows.length; i++) {
        const diff = differenceInDays(rows[i].date, rows[i - 1].date);
        if (diff > maxGap) maxGap = diff;
        if (diff > 14) { 
            gaps.push({ start: rows[i - 1].date, end: rows[i].date, days: diff });
        }
    }

    const activityContinuityStatus = gaps.length === 0 ? "Verified" : "Unverified (Unexplained gaps detected)";
    const overallCompleteness = (accountIdentificationStatus === "Verified" && activityContinuityStatus === "Verified") 
        ? "Verified" : "Unverified";

    // 2. Duplicates
    const duplicateGroups: { [key: string]: number[] } = {};
    rows.forEach(r => {
        const key = `${r.date.toISOString().split('T')[0]}_${r.amount}_${r.description.toLowerCase().trim()}`;
        if (!duplicateGroups[key]) duplicateGroups[key] = [];
        duplicateGroups[key].push(r.rowNum);
    });
    const exactDuplicates = Object.values(duplicateGroups).filter(lines => lines.length > 1);

    // 3. Transfers
    let potentialTransfers = rows.filter(r => 
        r.description.toLowerCase().includes("transfer") || 
        r.description.toLowerCase().includes("zelle") || 
        r.description.toLowerCase().includes("venmo")
    );
    
    let confirmedInternalPairs = 0;
    let unresolvedOrProbable = 0; // Fee diffs, timing diffs, split transfers, unmatched

    let usedIndices = new Set<number>();
    for (let i = 0; i < potentialTransfers.length; i++) {
        if (usedIndices.has(i)) continue;
        let matched = false;
        for (let j = 0; j < potentialTransfers.length; j++) {
            if (i === j || usedIndices.has(j)) continue;
            
            const ti = potentialTransfers[i];
            const tj = potentialTransfers[j];
            
            const amtDiff = Math.abs(ti.amount + tj.amount);
            const dateDiff = Math.abs(differenceInDays(ti.date, tj.date));
            
            // Strictly exact zero-sum on same or neighboring day
            if (amtDiff < 0.01 && dateDiff <= 3) {
                confirmedInternalPairs++;
                usedIndices.add(i);
                usedIndices.add(j);
                matched = true;
                break;
            }
        }
        if (!matched) unresolvedOrProbable++;
    }

    // 4. Usable Rolling Origins
    const getOrigins = (trainingWks: number) => {
        const origins = totalCompleteCalendarWeeks - trainingWks - 13 + 1;
        return origins > 0 ? origins : 0;
    };

    console.log("==================================================");
    console.log("= FILE VALIDATION REPORT (ISOLATED/READ-ONLY)    =");
    console.log("==================================================");
    console.log(`Total Rows Parsed       : ${rows.length}`);
    console.log(`Date Range              : ${earliestDate.toISOString().split('T')[0]} to ${latestDate.toISOString().split('T')[0]}`);
    console.log(`Total Complete Weeks    : ${totalCompleteCalendarWeeks} (Monday-starting)`);
    console.log("");
    console.log("--- Completeness Assessment ---");
    console.log(`Overall Completeness    : ${overallCompleteness}`);
    console.log(`- Account Identification: ${accountIdentificationStatus}`);
    console.log(`- Export/Period Coverage: Derived as ${totalDays} days`);
    console.log(`- Activity Continuity   : ${activityContinuityStatus}`);
    console.log("");
    console.log("--- Anomalies ---");
    console.log(`Unexplained Gaps >14d   : ${gaps.length > 0 ? gaps.map(g => `${g.days} days (${g.start.toISOString().split('T')[0]})`).join(', ') : 'None'}`);
    console.log(`Exact Duplicates        : ${exactDuplicates.length} groups detected`);
    console.log("");
    console.log("--- Transfer Classification ---");
    console.log(`Confirmed Internal Pairs: ${confirmedInternalPairs} (Strict zero-sum match)`);
    console.log(`Unresolved or Probable  : ${unresolvedOrProbable} (Unmatched, fee diffs, timing diffs, etc.)`);
    console.log(`NOTE: Unresolved transfers are NOT automatically treated as operating activity.`);
    console.log("");
    console.log("--- Usable 13-Week Rolling Origins ---");
    console.log(`4-Week Window Model     : ${getOrigins(4)} origins`);
    console.log(`12-Week Window Model    : ${getOrigins(12)} origins`);
    console.log(`26-Week Window Model    : ${getOrigins(26)} origins`);
    console.log(`52-Week Mature Model    : ${getOrigins(52)} origins`);
    console.log("");
    console.log("--- Live Workflow Finding ---");
    console.log(`CRITICAL CONTROL: Weekly advancement does NOT ingest transactions. `);
    console.log(`It recalculates using whatever bank history has already been manually uploaded.`);
    console.log("==================================================");
    
    return {
        totalRows: rows.length,
        totalCompleteCalendarWeeks,
        overallCompleteness,
        gaps,
        exactDuplicates,
        confirmedInternalPairs,
        unresolvedOrProbable,
        origins52: getOrigins(52)
    };
}

function extractRows(data: any[]): BankRow[] {
    const rows: BankRow[] = [];
    for (const raw of data) {
        // Sanitize keys (remove weird chars, trim)
        const row: any = {};
        for (const k of Object.keys(raw)) {
            const cleanKey = k.replace(/\uFFFD/g, "").trim();
            row[cleanKey] = raw[k];
        }

        const rawDate = row["Date"] || row["date"] || row["Posted Date"] || row["Post Date"];
        let rawAmount = row["Amount"] || row["amount"];
        
        // Handle Cascio-specific Debit/Credit split
        if (rawAmount === undefined && (row["Debit"] !== undefined || row["Credit"] !== undefined)) {
            const credit = parseFloat(row["Credit"]) || 0;
            const debit = parseFloat(row["Debit"]) || 0;
            rawAmount = credit > 0 ? credit : -debit;
        }

        let rawDesc = row["Description"] || row["description"] || row["Payee"];
        if (!rawDesc) {
            // Fallback for Cascio
            const detail = row["Detail"] ? String(row["Detail"]).trim() : "";
            const bai = row["BAI Description"] ? String(row["BAI Description"]).trim() : "";
            rawDesc = detail ? detail : bai;
        }

        const rawAccount = row["Account"] || row["account"] || row["Account Number"];

        if (!rawDate || rawAmount === undefined || rawAmount === null) continue;

        let dateObj = new Date(rawDate);
        if (isNaN(dateObj.getTime())) {
            // Excel serial dates might come through if not parsed correctly by xlsx, but xlsx usually parses them if cellDates: true. 
            // Fallback for mm/dd/yyyy
            if (typeof rawDate === 'string') {
                const parts = rawDate.split("/");
                if (parts.length === 3) {
                    dateObj = new Date(`${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}T00:00:00Z`);
                }
            } else if (typeof rawDate === 'number') {
                // Excel serial date fallback
                dateObj = new Date(Math.round((rawDate - 25569) * 86400 * 1000));
            }
        }

        const amount = typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount).replace(/[^0-9.-]/g, ""));

        if (!isNaN(dateObj.getTime()) && !isNaN(amount)) {
            rows.push({
                date: dateObj,
                amount,
                description: String(rawDesc || ""),
                account: String(rawAccount),
                rowNum: rows.length + 2, // Approximate
            });
        }
    }
    return rows;
}

if (process.argv[1] && process.argv[1].endsWith("validate-backtest-file.ts")) {
    const filePath = process.argv[2];
    if (!filePath) {
        console.error("Usage: npx ts-node scripts/validate-backtest-file.ts <path-to-file.csv|.xlsx|.xls>");
        process.exit(1);
    }
    validateBankFile(filePath);
}
