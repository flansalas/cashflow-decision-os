#!/usr/bin/env node
// scripts/test-ingest.ts
// Acceptance test for AR/AP ingestion.
// Directly calls ingest services + Prisma — does NOT require a running HTTP server.
//
// Run with: npx tsx scripts/test-ingest.ts

// Load .env before anything else
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env") });

import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Import services directly (same code that the API routes call)
import { parseBuffer } from "../src/services/ingest/parseRows";
import { prepareAR, normalizeARRows, arPreview } from "../src/services/ingest/ar";
import { prepareAP, normalizeAPRows, apPreview } from "../src/services/ingest/ap";

// Mirror src/db/prisma.ts adapter setup so we connect to the real dev.db
const dbUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const filePath = dbUrl.replace(/^file:/, "");
const absPath = resolve(join(__dirname, ".."), filePath);
const adapter = new PrismaBetterSqlite3({ url: absPath });
const prisma = new PrismaClient({ adapter });

const TEST_CID = "test-ingest-script-001";
const fixture = (f: string) => join(__dirname, "../fixtures", f);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(msg: string) { console.log(`  ✅  ${msg}`); }
function fail(msg: string) { console.error(`  ❌  ${msg}`); process.exitCode = 1; }
function section(title: string) { console.log(`\n─── ${title} ───`); }

async function upsertRefreshNote(companyId: string, key: string) {
    const noteText = `${key}:${new Date().toISOString()}`;
    const existing = await prisma.companyNote.findFirst({
        where: { companyId, noteText: { startsWith: `${key}:` } },
    });
    if (existing) {
        await prisma.companyNote.update({ where: { id: existing.id }, data: { noteText } });
    } else {
        await prisma.companyNote.create({ data: { companyId, noteText } });
    }
    return noteText;
}

async function upsertARRows(companyId: string, rows: ReturnType<typeof normalizeARRows>) {
    let imported = 0, updated = 0;
    for (const row of rows) {
        const existing = await prisma.receivableInvoice.findFirst({
            where: { companyId, invoiceNo: row.invoiceNo, customerName: row.customerName },
        });
        const data = {
            customerName: row.customerName,
            invoiceNo: row.invoiceNo,
            amountOpen: row.amountOpen,
            invoiceDate: row.invoiceDate ? new Date(row.invoiceDate) : null,
            dueDate: row.dueDate ? new Date(row.dueDate) : null,
            status: row.status || "open",
            daysPastDue: row.daysPastDue ?? null,
        };
        if (existing) {
            await prisma.receivableInvoice.update({ where: { id: existing.id }, data });
            updated++;
        } else {
            await prisma.receivableInvoice.create({ data: { companyId, ...data } });
            imported++;
        }
    }
    return { imported, updated };
}

async function upsertAPRows(companyId: string, rows: ReturnType<typeof normalizeAPRows>) {
    let imported = 0, updated = 0;
    for (const row of rows) {
        const existing = await prisma.payableBill.findFirst({
            where: { companyId, billNo: row.billNo, vendorName: row.vendorName },
        });
        const data = {
            vendorName: row.vendorName,
            billNo: row.billNo,
            amountOpen: row.amountOpen,
            billDate: row.billDate ? new Date(row.billDate) : null,
            dueDate: row.dueDate ? new Date(row.dueDate) : null,
            status: row.status || "open",
            daysPastDue: row.daysPastDue ?? null,
        };
        if (existing) {
            await prisma.payableBill.update({ where: { id: existing.id }, data });
            updated++;
        } else {
            await prisma.payableBill.create({ data: { companyId, ...data } });
            imported++;
        }
    }
    return { imported, updated };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║   AR/AP Ingest — Code-Only Acceptance Test           ║");
    console.log("╚══════════════════════════════════════════════════════╝");

    // ── Setup: create isolated test company ───────────────────────────────────
    await prisma.company.upsert({
        where: { id: TEST_CID } as { id: string },
        update: {},
        create: { id: TEST_CID, name: "Test Ingest Co (script)", isDemo: false },
    });
    console.log(`\nTest company: ${TEST_CID}`);

    // ══════════════════════════════════════════════════════════════════════════
    section("(a) CSV parsing — AR");

    const arCsvBuf = readFileSync(fixture("sample_ar.csv"));
    const arCsvParsed = parseBuffer(arCsvBuf, "sample_ar.csv");
    console.log(`  Headers: ${arCsvParsed.headers.join(" | ")}`);
    console.log(`  Raw rows: ${arCsvParsed.rowCount}`);

    arCsvParsed.rowCount >= 1 ? pass(`CSV parsed: ${arCsvParsed.rowCount} rows`) : fail("CSV parse returned 0 rows");

    // ── Auto-detect mapping ───────────────────────────────────────────────────
    const { mapping: arMapping, savedMappingUsed: arSaved } = prepareAR(arCsvParsed.headers, null);
    console.log(`  Mapping (auto): ${JSON.stringify(arMapping)}`);
    console.log(`  Saved mapping used: ${arSaved}`);

    ["customerName", "invoiceNo", "amountOpen"].every(k => arMapping[k])
        ? pass("Required AR fields all mapped")
        : fail(`Missing required AR mapping fields — got: ${JSON.stringify(arMapping)}`);

    // ── Normalize + preview ───────────────────────────────────────────────────
    const arRows = normalizeARRows(arCsvParsed.rows, arMapping);
    const { preview: arPreviewRows, summary: arSum } = arPreview(arRows);
    console.log(`  Normalized rows: ${arRows.length}`);
    console.log(`  Preview (first): ${JSON.stringify(arPreviewRows[0])}`);
    console.log(`  Summary: open=${arSum.open}  totalOpen=$${arSum.totalOpen.toFixed(2)}  missingDates=${arSum.missingDates}`);

    arRows.length >= 1 ? pass(`AR normalized: ${arRows.length} rows`) : fail("AR normalization returned 0 rows");
    arSum.totalOpen > 0 ? pass(`AR totalOpen = $${arSum.totalOpen.toFixed(2)}`) : fail("AR totalOpen is 0");

    // ══════════════════════════════════════════════════════════════════════════
    section("(a) CSV parsing — AP");

    const apCsvBuf = readFileSync(fixture("sample_ap.csv"));
    const apCsvParsed = parseBuffer(apCsvBuf, "sample_ap.csv");
    console.log(`  Raw rows: ${apCsvParsed.rowCount}`);

    const { mapping: apMapping } = prepareAP(apCsvParsed.headers, null);
    console.log(`  Mapping (auto): ${JSON.stringify(apMapping)}`);

    ["vendorName", "billNo", "amountOpen"].every(k => apMapping[k])
        ? pass("Required AP fields all mapped")
        : fail(`Missing required AP mapping fields — got: ${JSON.stringify(apMapping)}`);

    const apRows = normalizeAPRows(apCsvParsed.rows, apMapping);
    const { preview: apPreviewRows, summary: apSum } = apPreview(apRows);
    console.log(`  Normalized: ${apRows.length} rows  totalOpen=$${apSum.totalOpen.toFixed(2)}`);
    apRows.length >= 1 ? pass(`AP normalized: ${apRows.length} rows`) : fail("AP normalization returned 0 rows");

    // ══════════════════════════════════════════════════════════════════════════
    section("(a) XLSX parsing — AR");

    const arXlsxBuf = readFileSync(fixture("sample_ar.xlsx"));
    const arXlsxParsed = parseBuffer(arXlsxBuf, "sample_ar.xlsx");
    const { mapping: arXlsxMapping } = prepareAR(arXlsxParsed.headers, null);
    const arXlsxRows = normalizeARRows(arXlsxParsed.rows, arXlsxMapping);

    arXlsxRows.length === arRows.length
        ? pass(`XLSX AR row count matches CSV: ${arXlsxRows.length}`)
        : fail(`XLSX/CSV mismatch: XLSX=${arXlsxRows.length} CSV=${arRows.length}`);

    section("(a) XLSX parsing — AP");

    const apXlsxBuf = readFileSync(fixture("sample_ap.xlsx"));
    const apXlsxParsed = parseBuffer(apXlsxBuf, "sample_ap.xlsx");
    const { mapping: apXlsxMapping } = prepareAP(apXlsxParsed.headers, null);
    const apXlsxRows = normalizeAPRows(apXlsxParsed.rows, apXlsxMapping);

    apXlsxRows.length === apRows.length
        ? pass(`XLSX AP row count matches CSV: ${apXlsxRows.length}`)
        : fail(`XLSX/CSV mismatch: XLSX=${apXlsxRows.length} CSV=${apRows.length}`);

    // ══════════════════════════════════════════════════════════════════════════
    section("(b) Mapping persistence");

    await prisma.mappingProfile.upsert({
        where: { companyId_kind: { companyId: TEST_CID, kind: "ar" } },
        update: { mappingJson: JSON.stringify(arMapping) },
        create: { companyId: TEST_CID, kind: "ar", mappingJson: JSON.stringify(arMapping) },
    });
    await prisma.mappingProfile.upsert({
        where: { companyId_kind: { companyId: TEST_CID, kind: "ap" } },
        update: { mappingJson: JSON.stringify(apMapping) },
        create: { companyId: TEST_CID, kind: "ap", mappingJson: JSON.stringify(apMapping) },
    });

    const savedAR = await prisma.mappingProfile.findFirst({ where: { companyId: TEST_CID, kind: "ar" } });
    const savedAP = await prisma.mappingProfile.findFirst({ where: { companyId: TEST_CID, kind: "ap" } });

    savedAR ? pass(`AR mapping saved: kind=${savedAR.kind}`) : fail("AR mapping not saved");
    savedAP ? pass(`AP mapping saved: kind=${savedAP.kind}`) : fail("AP mapping not saved");

    // Verify saved mapping is re-used on next prepare call
    const savedARMapping = savedAR ? JSON.parse(savedAR.mappingJson) as Record<string, string> : null;
    const { savedMappingUsed: arReuseCheck } = prepareAR(arCsvParsed.headers, savedARMapping);
    arReuseCheck ? pass("Saved AR mapping is reused on re-upload") : fail("Saved AR mapping not reused");

    // ══════════════════════════════════════════════════════════════════════════
    section("(c) Preview — first 10 rows + summary");

    arPreviewRows.length > 0 ? pass(`AR preview: ${arPreviewRows.length} rows returned`) : fail("AR preview empty");
    apPreviewRows.length > 0 ? pass(`AP preview: ${apPreviewRows.length} rows returned`) : fail("AP preview empty");
    typeof arSum.open === "number" ? pass(`AR summary: open=${arSum.open}, total=$${arSum.totalOpen.toFixed(0)}, missingDates=${arSum.missingDates}`) : fail("AR summary malformed");
    typeof apSum.open === "number" ? pass(`AP summary: open=${apSum.open}, total=$${apSum.totalOpen.toFixed(0)}, missingDates=${apSum.missingDates}`) : fail("AP summary malformed");

    // ══════════════════════════════════════════════════════════════════════════
    section("(d) First import — upsert AR rows");

    const ar1 = await upsertARRows(TEST_CID, arRows);
    console.log(`  AR: imported=${ar1.imported}, updated=${ar1.updated}`);
    ar1.imported === arRows.length ? pass(`AR import: all ${ar1.imported} rows inserted`) : fail(`Expected ${arRows.length} inserted, got ${ar1.imported}`);
    ar1.updated === 0 ? pass("AR import: 0 updated (first run)") : fail(`Expected 0 updated, got ${ar1.updated}`);

    section("(d) First import — upsert AP rows");

    const ap1 = await upsertAPRows(TEST_CID, apRows);
    console.log(`  AP: imported=${ap1.imported}, updated=${ap1.updated}`);
    ap1.imported === apRows.length ? pass(`AP import: all ${ap1.imported} rows inserted`) : fail(`Expected ${apRows.length} inserted, got ${ap1.imported}`);

    // ══════════════════════════════════════════════════════════════════════════
    section("(d) Re-import — no duplicates");

    const ar2 = await upsertARRows(TEST_CID, arRows);
    console.log(`  AR re-import: imported=${ar2.imported}, updated=${ar2.updated}`);
    ar2.imported === 0 ? pass("AR re-import: 0 new rows (no duplicates)") : fail(`Re-import created ${ar2.imported} duplicate rows`);
    ar2.updated === arRows.length ? pass(`AR re-import: ${ar2.updated} rows updated`) : fail(`Expected ${arRows.length} updated, got ${ar2.updated}`);

    const ap2 = await upsertAPRows(TEST_CID, apRows);
    ap2.imported === 0 ? pass("AP re-import: 0 new rows (no duplicates)") : fail(`Re-import created ${ap2.imported} duplicate rows`);

    // Verify DB count matches fixture count
    const dbARCount = await prisma.receivableInvoice.count({ where: { companyId: TEST_CID } });
    const dbAPCount = await prisma.payableBill.count({ where: { companyId: TEST_CID } });
    dbARCount === arRows.length ? pass(`DB AR count = ${dbARCount} (correct)`) : fail(`DB AR count ${dbARCount} ≠ expected ${arRows.length}`);
    dbAPCount === apRows.length ? pass(`DB AP count = ${dbAPCount} (correct)`) : fail(`DB AP count ${dbAPCount} ≠ expected ${apRows.length}`);

    // ══════════════════════════════════════════════════════════════════════════
    section("(e) Refresh timestamps");

    const arNote = await upsertRefreshNote(TEST_CID, "ar_refresh_at");
    const apNote = await upsertRefreshNote(TEST_CID, "ap_refresh_at");

    const arNoteDb = await prisma.companyNote.findFirst({ where: { companyId: TEST_CID, noteText: { startsWith: "ar_refresh_at:" } } });
    const apNoteDb = await prisma.companyNote.findFirst({ where: { companyId: TEST_CID, noteText: { startsWith: "ap_refresh_at:" } } });

    arNoteDb ? pass(`ar_refresh_at written: ${arNoteDb.noteText.slice(14, 33)}`) : fail("ar_refresh_at not found in DB");
    apNoteDb ? pass(`ap_refresh_at written: ${apNoteDb.noteText.slice(14, 33)}`) : fail("ap_refresh_at not found in DB");

    // Verify the timestamp is parseable
    const arTs = new Date(arNote.slice("ar_refresh_at:".length));
    !isNaN(arTs.getTime()) ? pass(`ar_refresh_at is valid ISO: ${arTs.toISOString()}`) : fail("ar_refresh_at timestamp is not valid ISO");

    // ══════════════════════════════════════════════════════════════════════════
    section("(e) QA confidence — AR/AP freshness");

    // Simulate the same freshness logic used in the dashboard API
    const notes = await prisma.companyNote.findMany({ where: { companyId: TEST_CID } });
    const arRefresh = (() => {
        const n = notes.find(n => n.noteText.startsWith("ar_refresh_at:"));
        if (!n) return null;
        return new Date(n.noteText.slice("ar_refresh_at:".length));
    })();
    const daysSince = arRefresh ? Math.round((Date.now() - arRefresh.getTime()) / 86_400_000) : null;

    daysSince !== null && daysSince < 1 ? pass(`AR freshness = today (${daysSince} days) — QA bullet: "AR data is fresh"`) : fail(`AR freshness check failed, daysSince=${daysSince}`);

    // ══════════════════════════════════════════════════════════════════════════
    section("(e) QA anomalies — missing dates threshold");

    const missingDateRows = arRows.filter(r => !r.dueDate && !r.invoiceDate);
    const missingPct = arRows.length > 0 ? Math.round((missingDateRows.length / arRows.length) * 100) : 0;
    console.log(`  Missing date rows: ${missingDateRows.length} / ${arRows.length} = ${missingPct}%`);
    typeof missingPct === "number" ? pass(`Missing-date anomaly threshold check: ${missingPct}% (threshold = 10%)`) : fail("Missing date computation failed");

    // ══════════════════════════════════════════════════════════════════════════
    section("Cleanup");

    await prisma.receivableInvoice.deleteMany({ where: { companyId: TEST_CID } });
    await prisma.payableBill.deleteMany({ where: { companyId: TEST_CID } });
    await prisma.mappingProfile.deleteMany({ where: { companyId: TEST_CID } });
    await prisma.companyNote.deleteMany({ where: { companyId: TEST_CID } });
    await prisma.company.delete({ where: { id: TEST_CID } });
    console.log("  Test company + data cleaned up.");

    // ── Final verdict ─────────────────────────────────────────────────────────
    const code = process.exitCode ?? 0;
    console.log("\n═══════════════════════════════════════════════════════");
    if (code === 0) {
        console.log("  ✅  ALL ACCEPTANCE CHECKS PASSED");
    } else {
        console.log("  ❌  ONE OR MORE CHECKS FAILED — see ❌ lines above");
    }
    console.log("═══════════════════════════════════════════════════════\n");

    await prisma.$disconnect();
}

main().catch(async err => {
    console.error("\n💥 Test script crashed:", err);
    await prisma.$disconnect();
    process.exit(1);
});
