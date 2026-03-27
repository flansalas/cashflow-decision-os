// POST /api/ingest/ar/confirm
// Accepts { companyId, rows: NormalizedARRow[], mappingJson }.
// Upserts ReceivableInvoice rows, persists MappingProfile, writes ar_refresh_at CompanyNote.
// Upsert key: (companyId, customerName, invoiceNo).
// Auto-archives open invoices that are NOT present in the new report (paid/voided in QB).
// Preserves user overrides (metaJson) when updating.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import type { NormalizedARRow } from "@/services/ingest/ar";

export async function POST(req: NextRequest) {
    const { companyId, rows, mappingJson } = await req.json() as {
        companyId: string;
        rows: NormalizedARRow[];
        mappingJson: Record<string, string>;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!rows?.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });

    let imported = 0;
    let updated = 0;
    let archived = 0;

    // Build a set of natural keys from the incoming report for fast lookup
    const reportKeys = new Set(rows.map(r => `${r.customerName}|||${r.invoiceNo}`));

    try {
        // ── Step 1: Upsert each invoice from the report ──────────────────────
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
                // Preserve existing metaJson (user overrides like expectedDate) on update;
                // only set it for new records.
            };

            if (existing) {
                // Preserve user overrides stored in metaJson — do not overwrite them.
                await prisma.receivableInvoice.update({
                    where: { id: existing.id },
                    data,
                });
                updated++;
            } else {
                await prisma.receivableInvoice.create({ data: { companyId, ...data } });
                imported++;
            }
        }

        // ── Step 2: Auto-archive open invoices absent from this report ───────
        // Any invoice that is still "open" in our DB but missing from the new
        // QB export was almost certainly paid, voided, or deleted in QB.
        // We flip its status to "void" so it no longer affects the forecast.
        const openInDb = await prisma.receivableInvoice.findMany({
            where: { companyId, status: "open" },
            select: { id: true, customerName: true, invoiceNo: true },
        });

        const toArchive = openInDb.filter(
            inv => !reportKeys.has(`${inv.customerName}|||${inv.invoiceNo}`)
        );

        if (toArchive.length > 0) {
            await prisma.receivableInvoice.updateMany({
                where: { id: { in: toArchive.map(i => i.id) } },
                data: { status: "void" },
            });
            archived = toArchive.length;
        }

        // ── Step 3: Persist mapping profile ─────────────────────────────────
        await prisma.mappingProfile.upsert({
            where: { companyId_kind: { companyId, kind: "ar" } },
            update: { mappingJson: JSON.stringify(mappingJson) },
            create: { companyId, kind: "ar", mappingJson: JSON.stringify(mappingJson) },
        });

        // Write ar_refresh_at timestamp
        await upsertRefreshNote(companyId, "ar_refresh_at");

        return NextResponse.json({ ok: true, imported, updated, archived, total: imported + updated });
    } catch (err: unknown) {
        console.error("AR confirm error:", err);
        return NextResponse.json({ error: "Import failed" }, { status: 500 });
    }
}

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
}
