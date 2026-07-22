export const dynamic = 'force-dynamic';
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

        const [stagedRows, totalRows] = await Promise.all([
            prisma.stagedImportRow.findMany({
                where: { importBatchId: batch.id, companyId: tenantId },
                orderBy: { sourceRowNumber: 'asc' },
                skip,
                take: limit
            }),
            prisma.stagedImportRow.count({
                where: { importBatchId: batch.id, companyId: tenantId }
            })
        ]);

        const batchSummary = {
            importType: batch.importType,
            filename: batch.filename,
            uploadedBy: batch.uploadedBy,
            uploadedAt: batch.uploadedAt,
            totalRows: batch.rowCount,
            validRows: batch.acceptedCount - batch.duplicateCount,
            invalidRows: batch.rejectedCount,
            duplicateRows: batch.duplicateCount,
            status: batch.status,
        };

        const rowPreview = stagedRows.map(r => {
            let matchBasis = null;
            if (r.conflictType !== "new" && r.conflictType !== "invalid") {
                if (batch.importType === "bank") {
                    matchBasis = r.conflictType === "exact_duplicate" ? "fingerprint" : "near_match";
                } else {
                    matchBasis = "document_number_and_counterparty";
                }
            }

            return {
                sourceRowNumber: r.sourceRowNumber,
                normalizedValues: JSON.parse(r.normalizedDataJson),
                validationErrors: r.validationErrorsJson ? JSON.parse(r.validationErrorsJson) : [],
                conflictType: r.conflictType,
                proposedAction: r.proposedAction,
                matchedRecordId: r.matchedRecordId,
                fieldDifferences: r.fieldDifferencesJson ? JSON.parse(r.fieldDifferencesJson) : null,
                matchBasis
            };
        });

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
        console.error("Preview API error:", error);
        return NextResponse.json({ error: "Failed to load preview" }, { status: 500 });
    }
}
