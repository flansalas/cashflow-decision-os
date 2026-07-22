export const dynamic = 'force-dynamic';
import { NextResponse } from "next/server";
import prisma from "../../../../db/prisma";
import { checkRollbackEligibility } from "../../../../services/rollback";

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const tenantId = url.searchParams.get("companyId");
        if (!tenantId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

        const importType = url.searchParams.get("importType");
        const status = url.searchParams.get("status");

        const whereClause: any = { companyId: tenantId };
        if (importType) whereClause.importType = importType;
        if (status) whereClause.status = status; // e.g. success, partial, failed, applied

        // We want to fetch ImportBatches along with their Applications
        const batches = await prisma.importBatch.findMany({
            where: whereClause,
            include: { application: true, stagedRows: true },
            orderBy: { uploadedAt: "desc" }
        });

        const history = [];

        for (const batch of batches) {
            let eligibleForRollback = false;
            let rollbackBlockedReason = null;
            let affectedRowCount = 0;

            if (batch.application && batch.application.status === "applied") {
                affectedRowCount = batch.application.insertedCount + batch.application.updatedCount;
                try {
                    await checkRollbackEligibility(tenantId, batch.application.id);
                    eligibleForRollback = true;
                } catch (e: any) {
                    eligibleForRollback = false;
                    rollbackBlockedReason = e.message;
                }
            }

            history.push({
                batchId: batch.id,
                importType: batch.importType,
                filename: batch.filename,
                uploadedBy: batch.uploadedBy,
                uploadedAt: batch.uploadedAt,
                rowCount: batch.rowCount,
                status: batch.application ? batch.application.status : batch.status,
                application: batch.application ? {
                    id: batch.application.id,
                    appliedAt: batch.application.appliedAt,
                    appliedBy: batch.application.appliedBy,
                    insertedCount: batch.application.insertedCount,
                    updatedCount: batch.application.updatedCount,
                    skippedCount: batch.application.skippedCount,
                    failedCount: batch.application.failedCount,
                    rolledBackAt: batch.application.rolledBackAt,
                    rolledBackBy: batch.application.rolledBackBy,
                    forecastHashBefore: batch.application.forecastHashBefore,
                    forecastHashAfter: batch.application.forecastHashAfter,
                    forecastHashBeforeRollback: batch.application.forecastHashBeforeRollback,
                    forecastHashAfterRollback: batch.application.forecastHashAfterRollback,
                    rollbackEnrichmentError: batch.application.rollbackEnrichmentError,
                    changeLogId: batch.application.changeLogId
                } : null,
                rollbackEligibility: batch.application ? {
                    eligible: eligibleForRollback,
                    blockedReason: rollbackBlockedReason,
                    affectedRowCount
                } : null,
                stagedRows: batch.stagedRows.map(r => ({
                    id: r.id,
                    sourceRowNumber: r.sourceRowNumber,
                    conflictType: r.conflictType,
                    userDecision: r.userDecision,
                    applyStatus: r.applyStatus,
                    rollbackStatus: r.rollbackStatus,
                    rollbackError: r.rollbackError
                }))
            });
        }

        return NextResponse.json({ history });
    } catch (error: any) {
        return NextResponse.json({ error: "Failed to fetch import history: " + error.message }, { status: 500 });
    }
}
