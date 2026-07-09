import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export async function GET(req: NextRequest) {
    try {
        const tenantId = await resolveTenant(req);
        if (!tenantId) {
            return NextResponse.json({ error: "Missing or invalid company" }, { status: 401 });
        }

        const batchId = req.nextUrl.searchParams.get("batchId");
        if (!batchId) {
            return NextResponse.json({ error: "Missing batchId" }, { status: 400 });
        }

        const page = parseInt(req.nextUrl.searchParams.get("page") || "1", 10);
        const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
        const skip = (page - 1) * limit;

        const batch = await prisma.importBatch.findFirst({
            where: { id: batchId, companyId: tenantId }
        });

        if (!batch) {
            return NextResponse.json({ error: "Batch not found" }, { status: 404 });
        }

        const filter = req.nextUrl.searchParams.get("filter") || "all";
        const whereClause: any = { importBatchId: batch.id, companyId: tenantId };

        if (filter === "unresolved") {
            whereClause.userDecision = null;
        }

        const [stagedRows, totalRows, allBatchRows] = await Promise.all([
            prisma.stagedImportRow.findMany({
                where: whereClause,
                orderBy: { sourceRowNumber: 'asc' },
                skip,
                take: limit
            }),
            prisma.stagedImportRow.count({
                where: whereClause
            }),
            prisma.stagedImportRow.findMany({
                where: { importBatchId: batch.id, companyId: tenantId },
                select: { conflictType: true, userDecision: true }
            })
        ]);

        let pendingCount = 0;
        let blockedCount = 0; // possible match without decision

        for (const r of allBatchRows) {
            if (!r.userDecision) {
                if (r.conflictType === "invalid" || r.conflictType === "exact_duplicate") {
                    // these must be skipped, but if they lack a userDecision they are implicitly unresolved?
                    // Actually the rules say: "Invalid rows may be skipped. Exact duplicates must be skipped. All actionable rows must have a valid decision... A batch with unresolved possible matches remains blocked"
                    // If they have no decision, it's pending.
                    pendingCount++;
                } else {
                    pendingCount++;
                    if (r.conflictType === "possible_match" || r.conflictType === "possible_duplicate") {
                        blockedCount++;
                    }
                }
            }
        }

        let reviewStatus = "pending_review";
        if (pendingCount === 0) {
            reviewStatus = "ready_to_apply";
        } else if (pendingCount < allBatchRows.length) {
            reviewStatus = blockedCount > 0 ? "blocked" : "partially_reviewed";
        } else {
            reviewStatus = blockedCount > 0 ? "blocked" : "pending_review";
        }

        const batchSummary = {
            importType: batch.importType,
            filename: batch.filename,
            uploadedAt: batch.uploadedAt,
            uploadedBy: batch.uploadedBy,
            totalRows: batch.rowCount,
            newRows: allBatchRows.filter(r => r.conflictType === "new").length,
            exactDuplicates: allBatchRows.filter(r => r.conflictType === "exact_duplicate").length,
            changedExisting: allBatchRows.filter(r => r.conflictType === "changed_existing").length,
            possibleMatches: allBatchRows.filter(r => r.conflictType === "possible_match" || r.conflictType === "possible_duplicate").length,
            invalidRows: allBatchRows.filter(r => r.conflictType === "invalid").length,
            reviewStatus
        };

        const rowPreview = await Promise.all(stagedRows.map(async (r) => {
            let matchBasis = null;
            if (r.conflictType !== "new" && r.conflictType !== "invalid") {
                if (batch.importType === "bank") {
                    matchBasis = r.conflictType === "exact_duplicate" ? "fingerprint" : "near_match";
                } else {
                    matchBasis = "document_number_and_counterparty";
                }
            }

            let candidates: any[] = [];
            if (r.conflictType === "possible_match") {
                if (batch.importType === "ar") {
                    // Just return all open invoices for this company as candidates for simplicity,
                    // or filter by amount/customer if we want to be smart. Let's just return a few recent/open ones.
                    candidates = await prisma.receivableInvoice.findMany({
                        where: { companyId: tenantId },
                        take: 50,
                        select: { id: true, invoiceNo: true, customerName: true, amountOpen: true }
                    });
                } else if (batch.importType === "ap") {
                    candidates = await prisma.payableBill.findMany({
                        where: { companyId: tenantId },
                        take: 50,
                        select: { id: true, billNo: true, vendorName: true, amountOpen: true }
                    });
                }
            }

            return {
                id: r.id,
                sourceRowNumber: r.sourceRowNumber,
                normalizedValues: JSON.parse(r.normalizedDataJson),
                validationErrors: r.validationErrorsJson ? JSON.parse(r.validationErrorsJson) : [],
                conflictType: r.conflictType,
                proposedAction: r.proposedAction,
                matchedRecordId: r.matchedRecordId,
                fieldDifferences: r.fieldDifferencesJson ? JSON.parse(r.fieldDifferencesJson) : null,
                matchBasis,
                userDecision: r.userDecision,
                reviewNote: r.reviewNote,
                linkedRecordId: r.linkedRecordId,
                candidates
            };
        }));

        return NextResponse.json({
            summary: batchSummary,
            rows: rowPreview,
            pagination: {
                page,
                limit,
                total: totalRows,
                totalPages: Math.ceil(totalRows / limit)
            }
        });

    } catch (error) {
        console.error("Review API error:", error);
        return NextResponse.json({ error: "Failed to load review data" }, { status: 500 });
    }
}
