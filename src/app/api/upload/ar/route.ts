export const dynamic = 'force-dynamic';
// POST /api/upload/ar
// Stages ReceivableInvoice rows as an ImportBatch + StagedImportRows.
// Does NOT apply any records directly — the /api/upload/apply route handles that.
// Saves MappingProfile for column memory. Records ar_refresh_at timestamp.
//
// Conflict classification (natural key: companyId + invoiceNo + customerName):
//   invalid            — missing required fields
//   exact_duplicate    — all fields identical, proposedAction=skip
//   changed_existing   — natural key matches but fields differ, proposedAction=review
//   new                — no match, proposedAction=insert
//
// Hidden records (managerial overrides) survive because we no longer deleteMany.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import { v4 as uuidv4 } from "uuid";

interface NormalizedARRow {
    customerName: string;
    invoiceNo: string;
    amountOpen: number;
    invoiceDate: string | null;
    dueDate: string | null;
    status: string;
    daysPastDue: number | null;
}

function rowsAreEqual(existing: any, incoming: NormalizedARRow): boolean {
    const isSameDate = (a: Date | null, b: string | null) => {
        if (!a && !b) return true;
        if (!a || !b) return false;
        return new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);
    };
    return (
        existing.customerName === incoming.customerName &&
        existing.invoiceNo === incoming.invoiceNo &&
        Number(existing.amountOpen) === Number(incoming.amountOpen) &&
        isSameDate(existing.invoiceDate, incoming.invoiceDate) &&
        isSameDate(existing.dueDate, incoming.dueDate) &&
        (existing.status || "open") === (incoming.status || "open")
    );
}

function fieldDifferences(existing: any, incoming: NormalizedARRow): Record<string, { before: any; after: any }> {
    const diffs: Record<string, { before: any; after: any }> = {};
    const toIso = (v: Date | null) => v ? new Date(v).toISOString().slice(0, 10) : null;
    if (Number(existing.amountOpen) !== Number(incoming.amountOpen)) {
        diffs.amountOpen = { before: Number(existing.amountOpen), after: Number(incoming.amountOpen) };
    }
    if (toIso(existing.dueDate) !== (incoming.dueDate ? new Date(incoming.dueDate).toISOString().slice(0, 10) : null)) {
        diffs.dueDate = { before: toIso(existing.dueDate), after: incoming.dueDate };
    }
    if (toIso(existing.invoiceDate) !== (incoming.invoiceDate ? new Date(incoming.invoiceDate).toISOString().slice(0, 10) : null)) {
        diffs.invoiceDate = { before: toIso(existing.invoiceDate), after: incoming.invoiceDate };
    }
    if ((existing.status || "open") !== (incoming.status || "open")) {
        diffs.status = { before: existing.status, after: incoming.status };
    }
    if ((existing.daysPastDue ?? null) !== (incoming.daysPastDue ?? null)) {
        diffs.daysPastDue = { before: existing.daysPastDue, after: incoming.daysPastDue };
    }
    return diffs;
}

export async function POST(req: NextRequest) {
    const authResult = await auth();
    if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const userId = authResult.userId;

    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { companyId: bodyCompanyId, rows, mappingJson } = await req.json() as {
        companyId?: string;
        rows: NormalizedARRow[];
        mappingJson: Record<string, string>;
    };

    if (bodyCompanyId && bodyCompanyId !== tenantId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const companyId = tenantId;

    if (!rows?.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });

    try {
        // Fetch all existing AR records for this company to classify conflicts
        const existingRecords = await prisma.receivableInvoice.findMany({
            where: { companyId },
        });

        // Build natural-key lookup map and invoiceNo lookup for possible matches
        const existingByKey = new Map<string, typeof existingRecords[0]>();
        const existingByInvoiceNo = new Map<string, typeof existingRecords[0][]>();
        for (const rec of existingRecords) {
            const key = `${(rec.invoiceNo || "").toLowerCase()}|||${(rec.customerName || "").toLowerCase()}`;
            existingByKey.set(key, rec);

            const invNo = (rec.invoiceNo || "").toLowerCase();
            if (invNo) {
                const arr = existingByInvoiceNo.get(invNo) || [];
                arr.push(rec);
                existingByInvoiceNo.set(invNo, arr);
            }
        }

        // Classify each row
        const stagedRowsData: {
            conflictType: string;
            proposedAction: string;
            matchedRecordId: string | null;
            normalizedDataJson: string;
            validationErrorsJson: string | null;
            fieldDifferencesJson: string | null;
            sourceRowNumber: number;
            userDecision: string | null;
        }[] = [];

        let newCount = 0;
        let dupeCount = 0;
        let changedCount = 0;
        let possibleMatchCount = 0;
        let invalidCount = 0;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const errors: string[] = [];

            if (!row.invoiceNo?.trim()) errors.push("invoiceNo is required");
            if (!row.customerName?.trim()) errors.push("customerName is required");
            if (typeof row.amountOpen !== "number" || isNaN(row.amountOpen)) errors.push("amountOpen must be a number");

            if (errors.length > 0) {
                invalidCount++;
                stagedRowsData.push({
                    conflictType: "invalid",
                    proposedAction: "skip",
                    matchedRecordId: null,
                    normalizedDataJson: JSON.stringify(row),
                    validationErrorsJson: JSON.stringify(errors),
                    fieldDifferencesJson: null,
                    sourceRowNumber: i + 1,
                    userDecision: "skip", // auto-skip invalids
                });
                continue;
            }

            const key = `${(row.invoiceNo || "").toLowerCase().trim()}|||${(row.customerName || "").toLowerCase().trim()}`;
            const existing = existingByKey.get(key);

            if (!existing) {
                const invNo = (row.invoiceNo || "").toLowerCase().trim();
                const candidates = existingByInvoiceNo.get(invNo) || [];
                const possibleMatch = candidates.find(c =>
                    Math.abs((c.amountOpen ?? 0) - row.amountOpen) < 0.01
                );

                if (possibleMatch) {
                    possibleMatchCount++;
                    stagedRowsData.push({
                        conflictType: "possible_match",
                        proposedAction: "review",
                        matchedRecordId: possibleMatch.id,
                        normalizedDataJson: JSON.stringify(row),
                        validationErrorsJson: null,
                        fieldDifferencesJson: null,
                        sourceRowNumber: i + 1,
                        userDecision: null,
                    });
                } else {
                    newCount++;
                    stagedRowsData.push({
                        conflictType: "new",
                        proposedAction: "insert",
                        matchedRecordId: null,
                        normalizedDataJson: JSON.stringify(row),
                        validationErrorsJson: null,
                        fieldDifferencesJson: null,
                        sourceRowNumber: i + 1,
                        userDecision: "accept_insert", // auto-accept new rows
                    });
                }
            } else if (rowsAreEqual(existing, row)) {
                dupeCount++;
                stagedRowsData.push({
                    conflictType: "exact_duplicate",
                    proposedAction: "skip",
                    matchedRecordId: existing.id,
                    normalizedDataJson: JSON.stringify(row),
                    validationErrorsJson: null,
                    fieldDifferencesJson: null,
                    sourceRowNumber: i + 1,
                    userDecision: "skip", // auto-skip exact duplicates
                });
            } else {
                changedCount++;
                const diffs = fieldDifferences(existing, row);
                stagedRowsData.push({
                    conflictType: "changed_existing",
                    proposedAction: "review",
                    matchedRecordId: existing.id,
                    normalizedDataJson: JSON.stringify(row),
                    validationErrorsJson: null,
                    fieldDifferencesJson: JSON.stringify(diffs),
                    sourceRowNumber: i + 1,
                    userDecision: null, // human must decide
                });
            }
        }

        // Determine batch status
        const hasUnresolved = changedCount > 0 || possibleMatchCount > 0;
        const status = hasUnresolved ? "staged" : "ready_to_apply";

        // Persist ImportBatch + StagedImportRows + MappingProfile atomically
        const newBatch = await prisma.$transaction(async (tx) => {
            const batch = await tx.importBatch.create({
                data: {
                    companyId,
                    importType: "ar",
                    filename: "ar_upload",
                    uploadedBy: userId,
                    rowCount: rows.length,
                    acceptedCount: newCount + dupeCount,
                    rejectedCount: invalidCount,
                    duplicateCount: dupeCount,
                    status,
                },
            });

            if (stagedRowsData.length > 0) {
                await tx.stagedImportRow.createMany({
                    data: stagedRowsData.map(r => ({
                        ...r,
                        id: uuidv4(),
                        companyId,
                        importBatchId: batch.id,
                        importType: "ar",
                        rawDataJson: r.normalizedDataJson,
                        validationStatus: r.conflictType === "invalid" ? "invalid" : "valid",
                    })),
                });
            }

            await tx.mappingProfile.upsert({
                where: { companyId_kind: { companyId, kind: "ar" } },
                update: { mappingJson: JSON.stringify(mappingJson) },
                create: { companyId, kind: "ar", mappingJson: JSON.stringify(mappingJson) },
            });

            return batch;
        });

        // Record refresh timestamp (best-effort, non-transactional)
        try {
            const key = "ar_refresh_at";
            const noteText = `${key}:${new Date().toISOString()}`;
            const existingNote = await prisma.companyNote.findFirst({
                where: { companyId, noteText: { startsWith: `${key}:` } },
            });
            if (existingNote) {
                await prisma.companyNote.update({ where: { id: existingNote.id }, data: { noteText } });
            } else {
                await prisma.companyNote.create({ data: { companyId, noteText } });
            }
        } catch (e) {
            console.warn("Failed to update ar_refresh_at note:", e);
        }

        return NextResponse.json({
            ok: true,
            batchId: newBatch.id,
            staged: rows.length,
            newCount,
            dupeCount,
            changedCount,
            possibleMatchCount,
            invalidCount,
            reviewStatus: newBatch.status
        });
    } catch (error) {
        console.error("AR upload error:", error);
        return NextResponse.json({ error: "Failed to stage AR data" }, { status: 500 });
    }
}
