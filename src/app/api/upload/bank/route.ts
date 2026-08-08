export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { createImportBatch } from "@/services/payment-memory";
import { triggerEvaluation, processEvaluationJobs } from "@/services/evaluation-job-worker";

import { resolveTenant } from "@/lib/tenant";
import { waitUntil } from "@vercel/functions";
import { buildAndCacheBaseline } from "@/services/baseline-snapshot";

interface NormalizedBankRow {
    date: string | null;
    description: string;
    amount: number;
    _raw?: Record<string, string>;
}

export async function POST(req: NextRequest) {
    const { rows, mappingJson, filename, companyId: bodyCompanyId, accountId, fileHash } = await req.json() as {
        rows: NormalizedBankRow[];
        mappingJson: Record<string, string>;
        filename?: string;
        companyId?: string;
        accountId?: string;
        fileHash?: string;
    };

    let tenantId = await resolveTenant(req);
    if (!tenantId && bodyCompanyId) {
        const comp = await prisma.company.findUnique({ where: { id: bodyCompanyId }, select: { id: true } });
        if (comp) tenantId = comp.id;
    }
    if (!tenantId) return NextResponse.json({ error: "Missing or invalid company" }, { status: 401 });
    const companyId = tenantId;

    if (!rows?.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });
    if (!accountId) return NextResponse.json({ error: "Target bank account mapping is required" }, { status: 400 });
    if (!fileHash) return NextResponse.json({ error: "Import file hash is required for idempotency" }, { status: 400 });

    const validAccount = await prisma.bankAccount.findUnique({ where: { id: accountId } });
    if (!validAccount || validAccount.companyId !== companyId) {
        return NextResponse.json({ error: "Invalid bank account mapping" }, { status: 403 });
    }

    let coveredStartDate = new Date('2099-12-31');
    let coveredEndDate = new Date('1970-01-01');
    for (const r of rows) {
        if (r.date) {
            const d = new Date(r.date);
            if (!isNaN(d.getTime())) {
                if (d < coveredStartDate) coveredStartDate = d;
                if (d > coveredEndDate) coveredEndDate = d;
            }
        }
    }
    if (coveredStartDate > coveredEndDate) {
        coveredStartDate = new Date();
        coveredEndDate = new Date();
    }

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
            select: { id: true, txDate: true, description: true, amount: true, txHash: true }
        });
        /**
         * Stable occurrence-aware txHash identity.
         * - normalise: company + account + date + description + amount
         * - disambiguate repeated identical rows within the same account via an
         *   occurrence ordinal (0-indexed count of identical sigs seen so far)
         *
         * Properties:
         *   1. Legitimate repeated rows in one source file → distinct hashes (occ0, occ1…)
         *   2. Re-uploading the exact same file produces the same hashes → idempotent
         *   3. Same row from different accounts → distinct (accountId is in the hash)
         *   4. Row reordering of unique rows → same hash (no positional dependence)
         *   5. Company + account ownership enforced by including both IDs
         */
        const computeStableTxHash = (
            cid: string,
            acctId: string,
            date: string | null,
            description: string,
            amount: number,
            ordinal: number
        ): string => {
            const normalizedDate = date ? (() => { const d = new Date(date); return isNaN(d.getTime()) ? 'null' : d.toISOString().slice(0, 10); })() : 'null';
            const normalizedDesc = (description || '').toLowerCase().trim().replace(/\s+/g, ' ');
            const normalizedAmount = amount.toFixed(2);
            const base = `${cid}|||${acctId}|||${normalizedDate}|||${normalizedDesc}|||${normalizedAmount}`;
            return `${base}|||occ${ordinal}`;
        };
        const existingFingerprints = new Set(existingTx.map(tx => tx.txHash).filter(Boolean));
        // Existing ordinal counters: track how many times each sig already appears in DB
        const existingOrdinalCounters: Record<string, number> = {};
        for (const tx of existingTx) {
            if (tx.txHash) {
                // Reconstruct sig from stored hash to count ordinals already used
                // Pattern: company|||account|||date|||desc|||amount|||occN
                const parts = tx.txHash.split('|||occ');
                if (parts.length === 2) {
                    const sigWithoutOcc = parts[0];
                    const prevCount = existingOrdinalCounters[sigWithoutOcc] ?? 0;
                    existingOrdinalCounters[sigWithoutOcc] = prevCount + 1;
                }
            }
        }
        const batchFingerprints = new Set<string>();
        // Per-batch ordinal counters starting from existing DB ordinals
        const batchOrdinalCounters: Record<string, number> = { ...existingOrdinalCounters };

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
                const normalizedDate = row.date ? (() => { const d = new Date(row.date!); return isNaN(d.getTime()) ? 'null' : d.toISOString().slice(0, 10); })() : 'null';
                const normalizedDesc = (row.description || '').toLowerCase().trim().replace(/\s+/g, ' ');
                const normalizedAmount = (row.amount || 0).toFixed(2);
                const sigBase = `${companyId}|||${accountId}|||${normalizedDate}|||${normalizedDesc}|||${normalizedAmount}`;
                const ordinal = batchOrdinalCounters[sigBase] ?? 0;
                batchOrdinalCounters[sigBase] = ordinal + 1;
                const fingerprint = `${sigBase}|||occ${ordinal}`;

                if (existingFingerprints.has(fingerprint) || batchFingerprints.has(fingerprint)) {
                    conflictType = "exact_duplicate";
                    proposedAction = "skip";
                    const existing = existingTx.find(tx => tx.txHash === fingerprint);
                    if (existing) matchedRecordId = existing.id;
                } else {
                    const parsedRowDate = row.date ? new Date(row.date) : null;
                    const rowDate = (parsedRowDate && !isNaN(parsedRowDate.getTime())) ? parsedRowDate.getTime() : 0;
                    const nearMatch = existingTx.find(tx => {
                        const txDate = tx.txDate.getTime();
                        return tx.amount === row.amount && rowDate > 0 && Math.abs(txDate - rowDate) <= 3 * 86400000;
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
                    status,
                    sourceDateStart: coveredStartDate,
                    sourceDateEnd: coveredEndDate,
                    fileHash
                }
            });

            const manifestRecord = await tx.bankImportManifest.create({
                data: {
                    id: require("crypto").randomUUID(),
                    companyId,
                    userCertified: false,
                    BankImportManifestAccount: {
                        create: {
                            id: require("crypto").randomUUID(),
                            bankAccountId: accountId,
                            coveredStartDate,
                            coveredEndDate,
                            userCertifiedAt: null,
                            importSuccess: invalidCount === 0,
                            rejectedRowCount: invalidCount
                        }
                    }
                }
            });

            // Atomically create or coalesce the EvaluationJob and Trigger
            await triggerEvaluation(companyId, 'bank_upload', manifestRecord.id, tx);

            if (stagedRowsData.length > 0) {
                await tx.stagedImportRow.createMany({
                    data: stagedRowsData.map(r => ({ ...r, importBatchId: newBatch.id }))
                });
            }

            // Auto-apply valid new bank transactions since there is no manual review UI for bank imports yet.
            const newTransactionsData = rows
                .map((row, index) => ({ row, staged: stagedRowsData[index], index }))
                .filter(item => item.staged.proposedAction === "insert")
                .map(item => {
                    const parsedD = item.row.date ? new Date(item.row.date) : new Date();
                    const txDate = isNaN(parsedD.getTime()) ? new Date() : parsedD;
                    // Recompute stable txHash for this row (ordinals already computed in stagedRowsData pass)
                    const normalizedDate = item.row.date ? (() => { const d = new Date(item.row.date!); return isNaN(d.getTime()) ? 'null' : d.toISOString().slice(0, 10); })() : 'null';
                    const normalizedDesc = (item.row.description || '').toLowerCase().trim().replace(/\s+/g, ' ');
                    const normalizedAmount = (item.row.amount || 0).toFixed(2);
                    // Get the ordinal that was assigned during staging (ordinal = batchOrdinalCounters[sigBase] - 1 after increment)
                    // We stored fingerprints in batchFingerprints; find the one matching this row
                    // Simplest: recompute from scratch using a separate counter per insert pass
                    const sigBase = `${companyId}|||${accountId}|||${normalizedDate}|||${normalizedDesc}|||${normalizedAmount}`;
                    // The ordinal was batchOrdinalCounters[sigBase] - 1 at time of staging for this row.
                    // Since we process rows in order, use a separate insert-time counter:
                    return {
                        companyId,
                        txDate,
                        description: item.row.description || "Bank Transaction",
                        amount: item.row.amount || 0,
                        direction: (item.row.amount || 0) >= 0 ? "inflow" : "outflow",
                        internalTransferStatus: "unresolved",
                        accountId: accountId,
                        // txHash assigned below after ordinal recompute
                        _sigBase: sigBase,
                    };
                });

            // Assign txHashes in order using a fresh counter (same logic as staging)
            const insertOrdinalCounters: Record<string, number> = { ...existingOrdinalCounters };
            const finalTransactionData = newTransactionsData.map((item: any) => {
                const ordinal = insertOrdinalCounters[item._sigBase] ?? 0;
                insertOrdinalCounters[item._sigBase] = ordinal + 1;
                const { _sigBase, ...rest } = item;
                return { ...rest, txHash: `${_sigBase}|||occ${ordinal}` };
            });

            if (finalTransactionData.length > 0) {
                await tx.bankTransaction.createMany({
                    data: finalTransactionData
                });
            }

            return { newBatch, manifestRecord };
        });

        // Bust the baseline cache FIRST so the 24-hour guard doesn't block the rebuild.
        // Then rebuild fresh from all available bank history.
        prisma.baselineSnapshot.deleteMany({ where: { companyId } }).catch(() => {});
        try {
            waitUntil(buildAndCacheBaseline(companyId).catch(err => {
                console.error("Async baseline cache failed after upload:", err);
            }));
        } catch (e) {
            console.error("Failed to schedule baseline cache via waitUntil:", e);
            buildAndCacheBaseline(companyId).catch(err => console.error("Async baseline cache failed (fallback):", err));
        }
        
        // Asynchronously start the worker to process the pending job
        try {
            waitUntil(processEvaluationJobs(companyId).catch(err => {
                console.error("Worker processing failed after upload:", err);
            }));
        } catch (e) {
            console.error("Failed to schedule evaluation jobs via waitUntil:", e);
            processEvaluationJobs(companyId).catch(err => console.error("Worker processing failed (fallback):", err));
        }

        return NextResponse.json({
            ok: true,
            status: batch.newBatch.status,
            batchId: batch.newBatch.id,
            imported: validCount,
            updated: 0,
            archived: 0,
            total: rows.length
        });
    } catch (err: unknown) {
        console.error("Bank confirm error:", err);

        // Check if it's a Prisma Unique Constraint error on [companyId, fileHash]
        if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
            return NextResponse.json({ error: "Duplicate import file. This file has already been imported." }, { status: 409 });
        }

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

        return NextResponse.json({ error: (err as Error).message ?? "Import failed" }, { status: 500 });
    }
}
