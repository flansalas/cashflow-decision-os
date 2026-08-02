export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { createImportBatch } from "@/services/payment-memory";
import { triggerEvaluation, processEvaluationJobs } from "@/services/evaluation-job-worker";

import { resolveTenant } from "@/lib/tenant";

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
            select: { id: true, txDate: true, description: true, amount: true }
        });
        const getBankFingerprint = (date: Date | string | null, desc: string, amt: number) => {
            let dStr = "";
            if (date) {
                const dObj = new Date(date);
                if (!isNaN(dObj.getTime())) {
                    try {
                        const yr = dObj.getFullYear();
                        if (yr >= 1900 && yr <= 2100) {
                            dStr = dObj.toISOString().slice(0, 10);
                        }
                    } catch { /* safe fallback */ }
                }
            }
            const cleanDesc = (desc || "").toLowerCase().replace(/\s+/g, "");
            return `${dStr}|||${cleanDesc}|||${amt}`;
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
                .map((row, index) => ({ row, staged: stagedRowsData[index] }))
                .filter(item => item.staged.proposedAction === "insert")
                .map(item => {
                    const parsedD = item.row.date ? new Date(item.row.date) : new Date();
                    const txDate = isNaN(parsedD.getTime()) ? new Date() : parsedD;
                    return {
                        companyId,
                        txDate,
                        description: item.row.description || "Bank Transaction",
                        amount: item.row.amount || 0,
                        direction: (item.row.amount || 0) >= 0 ? "inflow" : "outflow",
                        // Default to unresolved, users must classify internal transfers explicitly later
                        internalTransferStatus: "unresolved",
                        accountId: accountId
                    };
                });

            if (newTransactionsData.length > 0) {
                await tx.bankTransaction.createMany({
                    data: newTransactionsData
                });
            }

            return { newBatch, manifestRecord };
        });

        // Bust the baseline cache FIRST so the 24-hour guard doesn't block the rebuild.
        // Then rebuild fresh from all available bank history.
        prisma.baselineSnapshot.deleteMany({ where: { companyId } }).catch(() => {});
        import("@/services/baseline-snapshot").then(({ buildAndCacheBaseline }) => {
            const { waitUntil } = require("@vercel/functions");
            waitUntil(buildAndCacheBaseline(companyId).catch(err => {
                console.error("Async baseline cache failed after upload:", err);
            }));
        });
        
        // Asynchronously start the worker to process the pending job
        const { waitUntil } = require("@vercel/functions");
        waitUntil(processEvaluationJobs(companyId).catch(err => {
            console.error("Worker processing failed after upload:", err);
        }));

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
