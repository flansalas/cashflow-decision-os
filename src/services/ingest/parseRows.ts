// services/ingest/parseRows.ts
// Server-side (Node-safe) Buffer → flat row array.
// Works in API routes, test scripts, and anywhere Buffer is available.
// Do NOT import browser-only APIs (File, FileReader, etc).

import * as XLSX from "xlsx";

export interface ParsedRows {
    headers: string[];
    rows: Record<string, string>[];
    rowCount: number;
}

/**
 * Parse a CSV or XLSX Buffer into flat rows.
 * @param buf      Raw file bytes
 * @param filename Used to detect extension when mimeType is ambiguous
 */
export function parseBuffer(buf: Buffer, filename: string): ParsedRows {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "csv") return parseCSV(buf);
    if (ext === "xlsx" || ext === "xls") return parseXLSX(buf);
    throw new Error(`Unsupported file type ".${ext}". Upload a CSV or XLSX file.`);
}

// ─── CSV via papaparse ────────────────────────────────────────────────────────

function parseCSV(buf: Buffer): ParsedRows {
    // Dynamic require so server-only code is not forced into client bundles
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Papa = require("papaparse") as typeof import("papaparse");
    const text = buf.toString("utf-8");
    const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
    });
    const headers = (result.meta.fields ?? []).filter(h => h.trim());
    const rows = (result.data as Record<string, string>[]).map(row => {
        const clean: Record<string, string> = {};
        for (const h of headers) clean[h] = String(row[h] ?? "").trim();
        return clean;
    });
    return { headers, rows, rowCount: rows.length };
}

// ─── XLSX via xlsx ────────────────────────────────────────────────────────────

function parseXLSX(buf: Buffer): ParsedRows {
    const workbook = XLSX.read(buf, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
    if (raw.length === 0) return { headers: [], rows: [], rowCount: 0 };

    const headers = (raw[0] as unknown[])
        .map(h => String(h ?? "").trim())
        .filter(Boolean);

    const rows: Record<string, string>[] = [];
    for (let i = 1; i < raw.length; i++) {
        const rowArr = raw[i] as unknown[];
        const isEmpty = rowArr.every(v => v === "" || v == null);
        if (isEmpty) continue;
        const obj: Record<string, string> = {};
        for (let j = 0; j < headers.length; j++) {
            const val = rowArr[j];
            if (val instanceof Date) {
                obj[headers[j]] = val.toISOString().slice(0, 10);
            } else {
                obj[headers[j]] = String(val ?? "").trim();
            }
        }
        rows.push(obj);
    }
    return { headers, rows, rowCount: rows.length };
}
