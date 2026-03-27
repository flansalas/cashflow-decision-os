import { NextRequest, NextResponse } from "next/server";

function extractText(buffer: ArrayBuffer): Promise<string> {
    return new Promise((resolve, reject) => {
        const PDFParser = require("pdf2json");
        const pdfParser = new PDFParser(null, 1); // 1 = Return raw text

        pdfParser.on("pdfParser_dataError", (errData: any) => reject(new Error(errData.parserError)));
        pdfParser.on("pdfParser_dataReady", () => {
            resolve(pdfParser.getRawTextContent());
        });
        pdfParser.parseBuffer(Buffer.from(buffer));
    });
}

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get("file") as File;
        if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

        const buffer = await file.arrayBuffer();
        const text = await extractText(buffer);

        // Basic heuristic table parser:
        // Split text by newlines
        const lines = text.split("\n").filter((l: string) => l.trim().length > 0);

        // Try to identify columns by splitting on 2 or more consecutive spaces or tabs
        let rawTable = lines.map((line: string) => line.trim().split(/\s{2,}|\t+/));

        // Filter out lines that don't look like data rows (e.g., titles, page numbers)
        let tableRows = rawTable.filter((row: string[]) => row.length > 1);

        if (tableRows.length < 3) {
            // Fallback 1: Try splitting on single spaces instead. This may fragment descriptions,
            // but provides a tabular layout for finding "amount" and "date".
            const spaceSplit = lines.map((line: string) => line.trim().split(/\s+/));
            if (spaceSplit.filter((row: string[]) => row.length > 1).length >= 3) {
                tableRows = spaceSplit;
            } else {
                // Fallback 2: Just assign each line to a single column.
                tableRows = lines.map((line: string) => [line.trim()]);
            }
        }

        // Search for a header row among the first 25 rows
        const keywords = ["amount", "date", "customer", "vendor", "bill", "invoice", "balance", "name", "number", "description", "payee", "memo", "post", "transaction"];
        let headerIdx = 0;
        for (let i = 0; i < Math.min(tableRows.length, 25); i++) {
            if (tableRows[i].some((col: string) => keywords.some(k => col.toLowerCase().includes(k)))) {
                headerIdx = i;
                break;
            }
        }

        // Extract headers
        const rawHeaders = tableRows[headerIdx] || [];
        const headers = rawHeaders.map((h: string, i: number) => h.trim() || `Column_${i + 1}`);

        // Extract rows
        const rows = [];
        for (let i = headerIdx + 1; i < tableRows.length; i++) {
            const rowArr = tableRows[i];
            const obj: Record<string, string> = {};
            for (let j = 0; j < Math.max(headers.length, rowArr.length); j++) {
                const header = headers[j] || `Column_${j + 1}`;
                obj[header] = rowArr[j]?.trim() ?? "";
            }
            rows.push(obj);
        }

        return NextResponse.json({
            headers: Array.from(new Set(Object.keys(rows[0] ?? {}))),
            rows,
            rowCount: rows.length,
            fileName: file.name
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
