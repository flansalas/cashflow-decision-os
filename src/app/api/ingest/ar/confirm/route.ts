import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import type { NormalizedARRow } from "@/services/ingest/ar";
import { createImportBatch } from "@/services/payment-memory";

import { resolveTenant } from "@/lib/tenant";

export async function POST(req: NextRequest) {
    const { rows, mappingJson, filename } = await req.json() as {
        rows: NormalizedARRow[];
        mappingJson: Record<string, string>;
        filename?: string;
    };

    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Missing or invalid company" }, { status: 401 });
    const companyId = tenantId;

    if (!rows?.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });

    let userId = null;
    try {
        const authResult = await auth();
        userId = authResult?.userId ?? null;
    } catch { /* safe fallback */ }

    try {
        const existingInvoices = await prisma.receivableInvoice.findMany({
            where: { companyId }
        });

        const existingMap = new Map();
        for (const inv of existingInvoices) {
            existingMap.set(`${inv.customerName}|||${inv.invoiceNo}`, inv);
        }

        let validCount = 0;
        let invalidCount = 0;
        let duplicateCount = 0;

        const stagedRowsData = rows.map((row, index) => {
            const { _raw, ...normalizedObj } = row;
            const rawDataJson = JSON.stringify(_raw || row);
            const normalizedDataJson = JSON.stringify(normalizedObj);

            let validationErrors: string[] = [];
            if (!row.customerName) validationErrors.push("Missing customer name");
            if (!row.invoiceNo) validationErrors.push("Missing invoice number");
            if (row.amountOpen == null || isNaN(row.amountOpen)) validationErrors.push("Invalid amount open");

            const validationStatus = validationErrors.length > 0 ? "invalid" : "valid";
            let conflictType = "new";
            let proposedAction = "insert";
            let matchedRecordId: string | null = null;
            let fieldDifferencesJson: string | null = null;

            if (validationStatus === "invalid") {
                conflictType = "invalid";
                proposedAction = "skip";
            } else {
                const key = `${row.customerName}|||${row.invoiceNo}`;
                const existing = existingMap.get(key);

                if (existing) {
                    matchedRecordId = existing.id;
                    const diffs: any[] = [];
                    // Compare fields
                    if (existing.amountOpen !== row.amountOpen) {
                        diffs.push({ field: "amountOpen", existing: existing.amountOpen, imported: row.amountOpen });
                    }
                    if (row.dueDate) {
                        const d1 = existing.dueDate ? new Date(existing.dueDate).toISOString().slice(0, 10) : null;
                        const d2 = new Date(row.dueDate).toISOString().slice(0, 10);
                        if (d1 !== d2) {
                            diffs.push({ field: "dueDate", existing: d1, imported: d2 });
                        }
                    }
                    if (row.invoiceDate) {
                        const d1 = existing.invoiceDate ? new Date(existing.invoiceDate).toISOString().slice(0, 10) : null;
                        const d2 = new Date(row.invoiceDate).toISOString().slice(0, 10);
                        if (d1 !== d2) {
                            diffs.push({ field: "invoiceDate", existing: d1, imported: d2 });
                        }
                    }

                    if (diffs.length === 0) {
                        conflictType = "exact_duplicate";
                        proposedAction = "skip";
                    } else {
                        conflictType = "changed_existing";
                        proposedAction = "review";
                        fieldDifferencesJson = JSON.stringify(diffs);
                    }
                } else {
                    // Check for possible match (same invoice number and amount, different customer name)
                    const possible = existingInvoices.find(i => i.invoiceNo === row.invoiceNo && i.amountOpen === row.amountOpen);
                    if (possible) {
                        conflictType = "possible_match";
                        proposedAction = "review";
                        matchedRecordId = possible.id;
                    }
                }
            }

            if (validationStatus === "invalid") invalidCount++;
            else if (conflictType === "exact_duplicate") duplicateCount++;
            else validCount++;

            return {
                companyId,
                importType: "ar",
                sourceRowNumber: index + 1,
                rawDataJson,
                normalizedDataJson,
                validationStatus,
                validationErrorsJson: validationErrors.length > 0 ? JSON.stringify(validationErrors) : null,
                conflictType,
                proposedAction,
                matchedRecordId,
                fieldDifferencesJson
            };
        });

        const status = invalidCount > 0 ? "staged_with_errors" : "staged";

        const batch = await prisma.$transaction(async (tx) => {
            // Persist mapping profile
            await tx.mappingProfile.upsert({
                where: { companyId_kind: { companyId, kind: "ar" } },
                update: { mappingJson: JSON.stringify(mappingJson) },
                create: { companyId, kind: "ar", mappingJson: JSON.stringify(mappingJson) },
            });

            const newBatch = await tx.importBatch.create({
                data: {
                    companyId,
                    importType: "ar",
                    filename: filename ?? "ar_import",
                    uploadedBy: userId,
                    rowCount: rows.length,
                    acceptedCount: validCount + duplicateCount,
                    rejectedCount: invalidCount,
                    duplicateCount,
                    status
                }
            });

            if (stagedRowsData.length > 0) {
                await tx.stagedImportRow.createMany({
                    data: stagedRowsData.map(r => ({ ...r, importBatchId: newBatch.id }))
                });
            }

            return newBatch;
        });

        return NextResponse.json({
            ok: true,
            status: batch.status,
            batchId: batch.id,
            imported: 0,
            updated: 0,
            archived: 0,
            total: 0
        });
    } catch (err: unknown) {
        console.error("AR confirm error:", err);

        try {
            await createImportBatch({
                companyId,
                importType: "ar",
                filename: filename ?? "ar_import",
                uploadedBy: userId,
                rowCount: rows?.length ?? 0,
                acceptedCount: 0,
                status: "failed",
                errorSummary: JSON.stringify([(err as Error).message ?? "Unknown error"]),
            });
        } catch (batchErr) {
            console.warn("Failed batch creation failed:", batchErr);
        }

        return NextResponse.json({ error: "Import failed" }, { status: 500 });
    }
}
