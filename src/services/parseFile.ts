// services/parseFile.ts – Client-side CSV/XLSX parsing to flat row arrays
// Pure function, no React. Runs entirely in browser.

import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ParsedFile {
    headers: string[];
    rows: Record<string, string>[];
    rowCount: number;
    fileName: string;
}

export async function parseFile(file: File): Promise<ParsedFile> {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

    if (ext === "csv") {
        return parseCsv(file);
    } else if (ext === "xlsx" || ext === "xls") {
        return parseXlsx(file);
    } else if (ext === "pdf") {
        return parsePdf(file);
    } else {
        throw new Error(`Unsupported file type ".${ext}". Upload a CSV, XLSX, or PDF file.`);
    }
}

async function parsePdf(file: File): Promise<ParsedFile> {
    const fd = new FormData();
    fd.append("file", file);

    const res = await fetch("/api/parse-pdf", {
        method: "POST",
        body: fd,
    });

    if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to parse PDF on the server.");
    }

    const data = await res.json();
    return data as ParsedFile;
}

function parseCsv(file: File): Promise<ParsedFile> {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete(results) {
                const headers = results.meta.fields ?? [];
                const rows = (results.data as Record<string, string>[]).map(row => {
                    const clean: Record<string, string> = {};
                    for (const h of headers) clean[h] = String(row[h] ?? "").trim();
                    return clean;
                });
                resolve({ headers, rows, rowCount: rows.length, fileName: file.name });
            },
            error(err) {
                reject(new Error(`CSV parse error: ${err.message}`));
            },
        });
    });
}

async function parseXlsx(file: File): Promise<ParsedFile> {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Convert to array-of-arrays to handle header row discovery
    const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    if (raw.length === 0) return { headers: [], rows: [], rowCount: 0, fileName: file.name };

    // Find the header row (first row with at least 3 non-empty cells, one of which looks like a keyword)
    let headerIdx = 0;
    const keywords = ["amount", "date", "customer", "vendor", "bill", "invoice", "balance", "name", "number"];
    for (let i = 0; i < Math.min(raw.length, 10); i++) {
        const rowArr = raw[i] as unknown[];
        const nonPoints = rowArr.filter(v => v != null && String(v).trim().length > 0);
        if (nonPoints.length >= 2) {
            const hasKeyword = nonPoints.some(v => keywords.some(k => String(v).toLowerCase().includes(k)));
            if (hasKeyword) {
                headerIdx = i;
                break;
            }
        }
    }

    const headers = (raw[headerIdx] as unknown[]).map(h => String(h ?? "").trim());
    const rows: Record<string, string>[] = [];

    for (let i = headerIdx + 1; i < raw.length; i++) {
        const rowArr = raw[i] as unknown[];
        const isEmpty = rowArr.every(v => v === "" || v == null);
        if (isEmpty) continue;
        const obj: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
            if (!headers[j]) continue;
            const val = rowArr[j];
            // Handle Excel date cells
            if (val instanceof Date) {
                obj[headers[j]] = val.toISOString().slice(0, 10);
            } else {
                obj[headers[j]] = String(val ?? "").trim();
            }
        }
        rows.push(obj);
    }

    return { headers: headers.filter(Boolean), rows, rowCount: rows.length, fileName: file.name };
}
