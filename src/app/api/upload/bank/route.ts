import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { createImportBatch } from "@/services/payment-memory";

import { resolveTenant } from "@/lib/tenant";

interface NormalizedBankRow {
    date: string | null;
    description: string;
    amount: number;
    _raw?: Record<string, string>;
}

export async function POST(req: NextRequest) {
    const { rows, mappingJson, filename } = await req.json() as {
        rows: NormalizedBankRow[];
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
        let validCount = 0;
        let invalidCount = 0;
        let duplicateCount = 0;

        const existingTx = await prisma.bankTransaction.findMany({
            where: { companyId },
            select: { id: true, txDate: true, description: true, amount: true }
        });
        const getBankFingerprint = (date: Date | string | null, desc: string, amt: number) => {
            const d = date ? new Date(date).toISOString().slice(0, 10) : "";
            const cleanDesc = (desc || "").toLowerCase().replace(/\s+/g, "");
            return `${d}|||${cleanDesc}|||${amt}`;
        };
        const existingFingerprints = new Set(existingTx.map(tx => getBankFingerprint(tx.txDate, tx.description, tx.amount)));
        const batchFingerprints = new Set<string>();

        const stagedRowsData = rows.map((row, index) => {
            const { _raw, ...normalizedObj } = row;
            const rawDataJson = JSON.stringify(_raw || row);
            const normalizedDataJson = JSON.stringify(normalizedObj);

            let validationErrors: string[] = [];
            if (!row.date) validationErrors.push("Missing transaction date");
            if (!row.description) validationErrors.push("Missing description");
            if (row.amount == null || isNaN(row.amount)) validationErrors.push("Invalid amount");

            const validationStatus = validationErrors.length > 0 ? "invalid" : "valid";
            let conflictType = "new";
            let proposedAction = "insert";
            let matchedRecordId: string | null = null;
            let fieldDifferencesJson: string | null = null;

            if (validationStatus === "invalid") {
                conflictType = "invalid";
                proposedAction = "skip";
            } else {
                const fingerprint = getBankFingerprint(row.date, row.description, row.amount);

                if (existingFingerprints.has(fingerprint) || batchFingerprints.has(fingerprint)) {
                    conflictType = "exact_duplicate";
                    proposedAction = "skip";
                    const existing = existingTx.find(tx => getBankFingerprint(tx.txDate, tx.description, tx.amount) === fingerprint);
                    if (existing) matchedRecordId = existing.id;
                } else {
                    const rowDate = new Date(row.date!).getTime();
                    const nearMatch = existingTx.find(tx => {
                        const txDate = tx.txDate.getTime();
                        return tx.amount === row.amount && Math.abs(txDate - rowDate) <= 3 * 86400000;
                    });
                    if (nearMatch) {
                        conflictType = "possible_duplicate";
                        proposedAction = "review";
                        matchedRecordId = nearMatch.id;
                    }
                }

                batchFingerprints.add(fingerprint);
            }

            if (validationStatus === "invalid") invalidCount++;
            else if (conflictType === "exact_duplicate") duplicateCount++;
            else validCount++;

            return {
                companyId,
                importType: "bank",
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
                where: { companyId_kind: { companyId, kind: "bank" } },
                update: { mappingJson: JSON.stringify(mappingJson) },
                create: { companyId, kind: "bank", mappingJson: JSON.stringify(mappingJson) },
            });

            const newBatch = await tx.importBatch.create({
                data: {
                    companyId,
                    importType: "bank",
                    filename: filename ?? "bank_import",
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

            // Auto-apply valid new bank transactions since there is no manual review UI for bank imports yet.
            const newTransactionsData = rows
                .map((row, index) => ({ row, staged: stagedRowsData[index] }))
                .filter(item => item.staged.proposedAction === "insert")
                .map(item => {
                    return {
                        companyId,
                        txDate: new Date(item.row.date!),
                        description: item.row.description,
                        amount: item.row.amount,
                        direction: item.row.amount >= 0 ? "inflow" : "outflow",
                    };
                });

            if (newTransactionsData.length > 0) {
                await tx.bankTransaction.createMany({
                    data: newTransactionsData
                });
            }

            return newBatch;
        });

        // Trigger the ACF auto-detection asynchronously so we don't block the upload response
        // Note: For a production scale we'd want this in a real queue (like Inngest, defer, etc)
        // For now we just kick off the promise and don't await it.
        import("@/services/acf-worker").then(({ runACFWorker }) => {
            runACFWorker(companyId).catch(err => {
                console.error("Background ACF Worker failed:", err);
            });
        });

        return NextResponse.json({
            ok: true,
            status: batch.status,
            batchId: batch.id,
            imported: validCount,
            updated: 0,
            archived: 0,
            total: rows.length
        });
    } catch (err: unknown) {
        console.error("Bank confirm error:", err);

        try {
            await createImportBatch({
                companyId,
                importType: "bank",
                filename: filename ?? "bank_import",
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
