#!/usr/bin/env node
// scripts/generate-fixtures.ts
// Generates sample_ar.xlsx and sample_ap.xlsx from the CSV fixtures.
// Run: npx tsx scripts/generate-fixtures.ts

import * as XLSX from "xlsx";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const fixturesDir = join(__dirname, "../fixtures");

function csvToXlsx(csvPath: string, xlsxPath: string) {
    const csv = readFileSync(csvPath, "utf-8");
    const wb = XLSX.read(csv, { type: "string" });
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    writeFileSync(xlsxPath, buf);
    console.log(`✓ Generated ${xlsxPath}`);
}

csvToXlsx(
    join(fixturesDir, "sample_ar.csv"),
    join(fixturesDir, "sample_ar.xlsx")
);

csvToXlsx(
    join(fixturesDir, "sample_ap.csv"),
    join(fixturesDir, "sample_ap.xlsx")
);

console.log("Done.");
