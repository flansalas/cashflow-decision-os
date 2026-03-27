// POST /api/ingest/ap/confirm
// Accepts { companyId, rows: NormalizedAPRow[], mappingJson }.
// Upserts PayableBill rows, persists MappingProfile, writes ap_refresh_at CompanyNote.
// Upsert key: (companyId, vendorName, billNo).
// Auto-archives open bills that are NOT present in the new report (paid/voided in QB).
// Applies aging-bucket projection: bills missing a dueDate get one computed from today + aging,
//   so they spread naturally across the 13-week forecast instead of piling into Week 1.
// Preserves user overrides (metaJson) when updating.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import type { NormalizedAPRow } from "@/services/ingest/ap";

// ─── Aging-bucket helpers ──────────────────────────────────────────────────

/**
 * Given a bill from the incoming report, compute the "projected due date" to store.
 *
 * Priority:
 *  1. Use dueDate as-is if the report provides one.
 *  2. If only billDate is present, assume Net-30.
 *  3. If daysPastDue is present, back-calculate the original due date.
 *  4. If nothing is available, project to today + 7 days (fallback bucket).
 *
 * Bills that are 90+ days past due with no due date override are considered
 * "stale disputes" and receive status "void" to keep the forecast clean.
 */
function computeProjectedDueDate(
    row: NormalizedAPRow,
    today: Date,
): { projectedDueDate: Date | null; isStale: boolean } {
    const daysPastDue = row.daysPastDue ?? null;

    // 1. Explicit due date — use it directly.
    if (row.dueDate) {
        const d = new Date(row.dueDate);
        // Mark stale if 90+ days overdue
        const agingDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);
        return { projectedDueDate: d, isStale: agingDays >= 90 };
    }

    // 2. Bill date + Net-30
    if (row.billDate) {
        const d = new Date(row.billDate);
        d.setDate(d.getDate() + 30);
        const agingDays = Math.round((today.getTime() - d.getTime()) / 86_400_000);
        return { projectedDueDate: d, isStale: agingDays >= 90 };
    }

    // 3. Days-past-due back-calculation
    if (daysPastDue != null) {
        if (daysPastDue >= 90) {
            // Very stale — remove from forecast, don't clog Week 1
            return { projectedDueDate: null, isStale: true };
        }
        if (daysPastDue >= 60) {
            // Distressed — project 14 days out (vendor is likely to push)
            const d = new Date(today);
            d.setDate(d.getDate() + 14);
            return { projectedDueDate: d, isStale: false };
        }
        if (daysPastDue >= 30) {
            // Overdue — project 7 days out
            const d = new Date(today);
            d.setDate(d.getDate() + 7);
            return { projectedDueDate: d, isStale: false };
        }
        if (daysPastDue >= 1) {
            // Slightly past due — treat as this week
            return { projectedDueDate: new Date(today), isStale: false };
        }
        // Current (daysPastDue === 0)
        return { projectedDueDate: new Date(today), isStale: false };
    }

    // 4. Fallback — no date info at all, assume 7 days
    const fallback = new Date(today);
    fallback.setDate(fallback.getDate() + 7);
    return { projectedDueDate: fallback, isStale: false };
}

// ─── Route ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    const { companyId, rows, mappingJson } = await req.json() as {
        companyId: string;
        rows: NormalizedAPRow[];
        mappingJson: Record<string, string>;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!rows?.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });

    const today = new Date();
    let imported = 0;
    let updated = 0;
    let archived = 0;
    let staled = 0;

    // Build a set of natural keys from the incoming report for fast lookup
    const reportKeys = new Set(rows.map(r => `${r.vendorName}|||${r.billNo}`));

    try {
        // ── Step 1: Upsert each bill from the report ──────────────────────
        for (const row of rows) {
            const existing = await prisma.payableBill.findFirst({
                where: { companyId, billNo: row.billNo, vendorName: row.vendorName },
            });

            const { projectedDueDate, isStale } = computeProjectedDueDate(row, today);

            const data = {
                vendorName: row.vendorName,
                billNo: row.billNo,
                amountOpen: row.amountOpen,
                billDate: row.billDate ? new Date(row.billDate) : null,
                // Store the projected date as dueDate so the forecast engine
                // picks it up and spreads the bill into the correct week.
                dueDate: projectedDueDate,
                status: isStale ? "void" : (row.status || "open"),
                daysPastDue: row.daysPastDue ?? null,
                // Preserve existing metaJson (user overrides like overrideDueDate) on update.
            };

            if (existing) {
                // Only update dueDate from projection if the user hasn't already
                // set a manual override (stored in metaJson).
                let existingMeta: Record<string, unknown> = {};
                try {
                    if (existing.metaJson) existingMeta = JSON.parse(existing.metaJson);
                } catch { /* ignore */ }

                const hasOverride = !!existingMeta.overrideDueDate;
                await prisma.payableBill.update({
                    where: { id: existing.id },
                    data: hasOverride
                        ? { ...data, dueDate: existing.dueDate } // keep user's override date
                        : data,
                });
                if (isStale) staled++;
                else updated++;
            } else {
                await prisma.payableBill.create({ data: { companyId, ...data } });
                if (isStale) staled++;
                else imported++;
            }
        }

        // ── Step 2: Auto-archive open bills absent from this report ──────────
        // Any bill still "open" in our DB but missing from the new QB export was
        // almost certainly paid, voided, or deleted in QB.
        const openInDb = await prisma.payableBill.findMany({
            where: { companyId, status: "open" },
            select: { id: true, vendorName: true, billNo: true },
        });

        const toArchive = openInDb.filter(
            bill => !reportKeys.has(`${bill.vendorName}|||${bill.billNo}`)
        );

        if (toArchive.length > 0) {
            await prisma.payableBill.updateMany({
                where: { id: { in: toArchive.map(b => b.id) } },
                data: { status: "void" },
            });
            archived = toArchive.length;
        }

        // ── Step 3: Persist mapping profile ─────────────────────────────────
        await prisma.mappingProfile.upsert({
            where: { companyId_kind: { companyId, kind: "ap" } },
            update: { mappingJson: JSON.stringify(mappingJson) },
            create: { companyId, kind: "ap", mappingJson: JSON.stringify(mappingJson) },
        });

        // Write ap_refresh_at timestamp
        await upsertRefreshNote(companyId, "ap_refresh_at");

        return NextResponse.json({
            ok: true,
            imported,
            updated,
            archived,
            staled,
            total: imported + updated + staled,
        });
    } catch (err: unknown) {
        console.error("AP confirm error:", err);
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
