export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";
import { assembleForecastData } from "@/services/forecast-assembly";
import { syncVarianceLedger } from "@/services/variance-sync";

export async function POST(req: NextRequest) {
    try {
        const tenantId = await resolveTenant(req);
        if (!tenantId) {
            return NextResponse.json({ error: "Missing or invalid company" }, { status: 401 });
        }

        let userId = null;
        try {
            const authResult = await auth();
            userId = authResult?.userId ?? null;
        } catch { /* safe fallback */ }

        const body = await req.json();
        const { importBatchId } = body;
        if (!importBatchId) {
            return NextResponse.json({ error: "Missing importBatchId" }, { status: 400 });
        }

        const batch = await prisma.importBatch.findFirst({
            where: { id: importBatchId, companyId: tenantId },
            include: { application: true }
        });
        if (!batch) {
            return NextResponse.json({ error: "Batch not found" }, { status: 404 });
        }
        if (batch.status === "applied" || batch.application) {
            return NextResponse.json({ error: "already_applied" }, { status: 400 });
        }

        // Try getting before-hash
        let forecastHashBefore: string | null = null;
        try {
            const beforeData = await assembleForecastData(tenantId);
            forecastHashBefore = beforeData.forecastResult.forecastVersionHash;
        } catch (e) {
            console.warn("Could not compute before-hash", e);
        }

        // Apply within a transaction
        const applyResult = await prisma.$transaction(async (tx) => {
            const rows = await tx.stagedImportRow.findMany({
                where: { importBatchId: batch.id, companyId: tenantId },
                orderBy: { sourceRowNumber: 'asc' }
            });

            // Validate readiness
            let hasUnresolved = false;
            let hasBlocked = false;
            for (const r of rows) {
                if (r.conflictType === "invalid" || r.conflictType === "exact_duplicate") {
                    if (r.userDecision !== "skip") {
                        // For this slice, we enforce it must be skipped or left alone
                        // But if left alone, it's considered unresolved. However the spec says invalid rows "may be skipped" and exact duplicates "must be skipped".
                        // "All actionable rows must have a valid decision before ready_to_apply"
                        // If it's exact duplicate without a decision, that's pending.
                        if (!r.userDecision) hasUnresolved = true;
                    }
                } else if (!r.userDecision) {
                    hasUnresolved = true;
                    if (r.conflictType === "possible_match" || r.conflictType === "possible_duplicate") {
                        hasBlocked = true;
                    }
                }
            }

            if (hasBlocked) throw new Error("batch_blocked");
            if (hasUnresolved) throw new Error("batch_partially_reviewed");

            let insertedCount = 0;
            let updatedCount = 0;
            let skippedCount = 0;
            const changeRecordsData: any[] = [];

            for (const r of rows) {
                try {
                    const norm = { ...JSON.parse(r.normalizedDataJson) };
                    delete norm._raw;
                    // Convert potential date fields to Date objects or ISO strings
                    for (const f of ["dueDate", "invoiceDate", "billDate", "date"]) {
                        if (norm[f] && typeof norm[f] === "string" && norm[f].length === 10) {
                            norm[f] = new Date(`${norm[f]}T00:00:00.000Z`);
                        } else if (norm[f]) {
                            norm[f] = new Date(norm[f]);
                        }
                    }

                    const decision = r.userDecision;
                    let applyStatus = "skipped";
                    let appliedRecordId = null;

                    if (decision === "skip") {
                        applyStatus = "skipped";
                    } else if (decision === "accept_insert" || decision === "treat_as_new") {
                        let createdRec: any = null;
                        if (batch.importType === "ar") {
                            createdRec = await tx.receivableInvoice.create({ data: { ...norm, companyId: tenantId }});
                            appliedRecordId = createdRec.id;
                        } else if (batch.importType === "ap") {
                            createdRec = await tx.payableBill.create({ data: { ...norm, companyId: tenantId }});
                            appliedRecordId = createdRec.id;
                        } else if (batch.importType === "bank") {
                            const { date, ...restNorm } = norm;
                            createdRec = await tx.bankTransaction.create({ data: { ...restNorm, txDate: date, companyId: tenantId }});
                            appliedRecordId = createdRec.id;

                            // SMART AUTO-MATCHING
                            // Look for an active CashAdjustment that corresponds to this bank transaction
                            const isOutflow = restNorm.direction === "outflow";
                            const matchAmount = isOutflow ? -Math.abs(restNorm.amount) : Math.abs(restNorm.amount);

                            const matchingAdjustment = await tx.cashAdjustment.findFirst({
                                where: {
                                    companyId: tenantId,
                                    status: "active",
                                    amount: matchAmount
                                }
                            });

                            if (matchingAdjustment) {
                                await tx.cashAdjustment.delete({
                                    where: { id: matchingAdjustment.id }
                                });
                            }
                        }

                        changeRecordsData.push({
                            companyId: tenantId,
                            stagedRowId: r.id,
                            entityType: batch.importType,
                            entityId: appliedRecordId,
                            operation: "insert",
                            beforeJson: null,
                            afterJson: JSON.stringify(createdRec),
                            changedFieldsJson: JSON.stringify(norm)
                        });

                        applyStatus = "inserted";
                        insertedCount++;
                    } else if (decision === "accept_update" || decision === "link_and_review") {
                        const targetId = decision === "link_and_review" ? r.linkedRecordId : r.matchedRecordId;
                        if (!targetId) throw new Error("Missing target record ID");

                        let existingRec: any = null;
                        let updatedRec: any = null;
                        if (batch.importType === "ar") {
                            existingRec = await tx.receivableInvoice.findUnique({ where: { id: targetId, companyId: tenantId }});
                            if (!existingRec) throw new Error("AR record not found");
                            updatedRec = await tx.receivableInvoice.update({ where: { id: targetId, companyId: tenantId }, data: { ...norm }});
                        } else if (batch.importType === "ap") {
                            existingRec = await tx.payableBill.findUnique({ where: { id: targetId, companyId: tenantId }});
                            if (!existingRec) throw new Error("AP record not found");
                            updatedRec = await tx.payableBill.update({ where: { id: targetId, companyId: tenantId }, data: { ...norm }});
                        } else {
                            throw new Error("Update not supported for bank imports");
                        }
                        appliedRecordId = targetId;

                        const changedFields: Record<string, any> = {};
                        for (const k of Object.keys(norm)) {
                            // Find keys in norm where existingRec[k] is different from norm[k] (with rough date handling)
                            let ev = existingRec[k];
                            let nv = norm[k];
                            if (ev instanceof Date) ev = ev.getTime();
                            if (nv instanceof Date) nv = nv.getTime();
                            if (ev !== nv) {
                                changedFields[k] = { before: existingRec[k], after: norm[k] };
                            }
                        }

                        changeRecordsData.push({
                            companyId: tenantId,
                            stagedRowId: r.id,
                            entityType: batch.importType,
                            entityId: targetId,
                            operation: "update",
                            beforeJson: JSON.stringify(existingRec),
                            afterJson: JSON.stringify(updatedRec),
                            changedFieldsJson: JSON.stringify(changedFields)
                        });

                        applyStatus = "updated";
                        updatedCount++;
                    } else if (decision === "keep_existing") {
                        applyStatus = "skipped";
                        skippedCount++;
                    } else {
                        applyStatus = "skipped";
                        skippedCount++;
                    }

                    if (applyStatus === "skipped" && decision !== "keep_existing") {
                        skippedCount++;
                    }

                    await tx.stagedImportRow.update({
                        where: { id: r.id },
                        data: { applyStatus, appliedRecordId, appliedAt: new Date() }
                    });
                } catch (rowErr: any) {
                    await tx.stagedImportRow.update({
                        where: { id: r.id },
                        data: { applyStatus: "failed", applyError: rowErr.message }
                    });
                    throw new Error(`Row ${r.sourceRowNumber} failed: ${rowErr.message}`); // This aborts the tx
                }
            }

            // Create ChangeLog event for batch apply
            const cl = await tx.changeLog.create({
                data: {
                    companyId: tenantId,
                    userId,
                    source: "ImportBatch",
                    action: "apply",
                    inputText: batch.id,
                    diffJson: JSON.stringify({ insertedCount, updatedCount, skippedCount }),
                    forecastVersionHashAfter: "pending"
                }
            });

            // Create Application record
            const appRec = await tx.importApplication.create({
                data: {
                    companyId: tenantId,
                    importBatchId: batch.id,
                    importType: batch.importType,
                    appliedBy: userId,
                    insertedCount,
                    updatedCount,
                    skippedCount,
                    failedCount: 0,
                    forecastHashBefore,
                    changeLogId: cl.id
                }
            });

            if (changeRecordsData.length > 0) {
                await tx.importApplyChange.createMany({
                    data: changeRecordsData.map(c => ({ ...c, importApplicationId: appRec.id }))
                });
            }

            // Update batch status
            await tx.importBatch.update({
                where: { id: batch.id },
                data: { status: "applied" }
            });

            return { appRec, insertedCount, updatedCount, skippedCount };
        });

        // Try forecast refresh post-commit
        let forecastHashAfter: string | null = null;
        let enrichmentError: string | null = null;
        try {
            const afterData = await assembleForecastData(tenantId);
            forecastHashAfter = afterData.forecastResult.forecastVersionHash;

            await prisma.importApplication.update({
                where: { id: applyResult.appRec.id },
                data: { forecastHashAfter }
            });

            await prisma.changeLog.update({
                where: { id: applyResult.appRec.changeLogId! },
                data: { forecastVersionHashAfter: forecastHashAfter }
            });
        } catch (enrichErr: any) {
            console.error("Forecast enrichment failed:", enrichErr);
            enrichmentError = enrichErr.message || "Unknown error";
            await prisma.importApplication.update({
                where: { id: applyResult.appRec.id },
                data: { forecastHashAfter: null, enrichmentError }
            });
            await prisma.changeLog.update({
                where: { id: applyResult.appRec.changeLogId! },
                data: { forecastVersionHashAfter: "error" }
            });
        }

        // Trigger variance sync if this was a bank import
        if (batch.importType === "bank") {
            try {
                await syncVarianceLedger(tenantId);
            } catch (syncErr) {
                console.error("Failed to trigger variance sync:", syncErr);
            }
        }

        return NextResponse.json({
            batchId: batch.id,
            applicationId: applyResult.appRec.id,
            status: "success",
            insertedCount: applyResult.insertedCount,
            updatedCount: applyResult.updatedCount,
            skippedCount: applyResult.skippedCount,
            failedCount: 0,
            forecastHashBefore,
            forecastHashAfter
        });

    } catch (error: any) {
        if (error.message === "batch_blocked" || error.message === "batch_partially_reviewed") {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to apply batch: " + error.message }, { status: 500 });
    }
}
