export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "../../../../db/prisma";
import { resolveTenant } from "../../../../lib/tenant";
import { checkRollbackEligibility } from "../../../../services/rollback";
import { assembleForecastData } from "../../../../services/forecast-assembly";

export async function POST(req: NextRequest) {
    try {
        const url = new URL(req.url);
        const urlCompanyId = url.searchParams.get("companyId");

        const authResult = await auth();
        if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const tenantId = await resolveTenant(req);
        if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        if (urlCompanyId && urlCompanyId !== tenantId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

        const userId = authResult.userId;

        const body = await req.json();
        const { applicationId } = body;
        if (!applicationId) return NextResponse.json({ error: "Missing applicationId" }, { status: 400 });

        // 1. Eligibility Check (Outside Tx for fail-fast)
        try {
            await checkRollbackEligibility(tenantId, applicationId);
        } catch (e: any) {
            if (e.message === "application_not_found") {
                return NextResponse.json({ error: "not found" }, { status: 404 });
            }
            return NextResponse.json({ error: e.message }, { status: 400 });
        }

        // 2. Pre-transaction forecast hash
        let forecastHashBeforeRollback: string | null = null;
        try {
            const beforeData = await assembleForecastData(tenantId);
            forecastHashBeforeRollback = beforeData.forecastResult.forecastVersionHash;
        } catch (e: any) {
            console.error("Could not capture before hash", e);
        }

        // 3. The Atomic Rollback Transaction
        await prisma.$transaction(async (tx) => {
            // Re-fetch with changes
            const application = await tx.importApplication.findFirst({
                where: { id: applicationId, companyId: tenantId },
                include: { changes: true, batch: true }
            });

            if (!application) {
                throw new Error("application_not_found");
            }
            if (application.status === "rolled_back") {
                throw new Error("already_rolled_back");
            }

            // Perform rollback actions per change
            for (const change of application.changes) {
                if (change.operation === "insert") {
                    if (change.entityType === "ar") {
                        await tx.receivableInvoice.deleteMany({ where: { id: change.entityId, companyId: tenantId } });
                    } else if (change.entityType === "ap") {
                        await tx.payableBill.deleteMany({ where: { id: change.entityId, companyId: tenantId } });
                    } else if (change.entityType === "bank") {
                        await tx.bankTransaction.deleteMany({ where: { id: change.entityId, companyId: tenantId } });
                    }
                } else if (change.operation === "update") {
                    const beforeFields = JSON.parse(change.beforeJson || "{}");
                    const changedFields = JSON.parse(change.changedFieldsJson || "{}");
                    const dataToRestore: any = {};
                    for (const key of Object.keys(changedFields)) {
                        dataToRestore[key] = beforeFields[key];
                    }
                    if (Object.keys(dataToRestore).length > 0) {
                        if (change.entityType === "ar") {
                            await tx.receivableInvoice.updateMany({ where: { id: change.entityId, companyId: tenantId }, data: dataToRestore });
                        } else if (change.entityType === "ap") {
                            await tx.payableBill.updateMany({ where: { id: change.entityId, companyId: tenantId }, data: dataToRestore });
                        }
                    }
                }

                await tx.stagedImportRow.update({
                    where: { id: change.stagedRowId },
                    data: { rollbackStatus: "rolled_back" }
                });
            }

            // Create rollback ChangeLog event
            const cl = await tx.changeLog.create({
                data: {
                    companyId: tenantId,
                    userId,
                    source: "ImportBatch",
                    action: "rollback",
                    inputText: application.batch.id,
                    diffJson: JSON.stringify({ rolledBackApplicationId: application.id }),
                    forecastVersionHashAfter: "pending"
                }
            });

            // Update application status
            await tx.importApplication.update({
                where: { id: application.id },
                data: {
                    status: "rolled_back",
                    rolledBackAt: new Date(),
                    rolledBackBy: userId,
                    forecastHashBeforeRollback,
                    changeLogId: cl.id
                }
            });
        });

        // 4. Post-transaction forecast hash
        let forecastHashAfterRollback: string | null = null;
        let rollbackEnrichmentError: string | null = null;
        try {
            const afterData = await assembleForecastData(tenantId);
            forecastHashAfterRollback = afterData.forecastResult.forecastVersionHash;

            await prisma.importApplication.update({
                where: { id: applicationId },
                data: { forecastHashAfterRollback }
            });
            const app = await prisma.importApplication.findUnique({ where: { id: applicationId }});
            if (app && app.changeLogId) {
                await prisma.changeLog.update({
                    where: { id: app.changeLogId },
                    data: { forecastVersionHashAfter: forecastHashAfterRollback }
                });
            }
        } catch (enrichErr: any) {
            console.error("Forecast enrichment failed:", enrichErr);
            rollbackEnrichmentError = enrichErr.message || "Unknown error";
            await prisma.importApplication.update({
                where: { id: applicationId },
                data: { forecastHashAfterRollback: null, rollbackEnrichmentError }
            });
            const app = await prisma.importApplication.findUnique({ where: { id: applicationId }});
            if (app && app.changeLogId) {
                await prisma.changeLog.update({
                    where: { id: app.changeLogId },
                    data: { forecastVersionHashAfter: "error" }
                });
            }
        }

        return NextResponse.json({
            status: "success",
            forecastHashBeforeRollback,
            forecastHashAfterRollback
        });

    } catch (error: any) {
        if (error.message === "application_not_found") {
            return NextResponse.json({ error: "not found" }, { status: 404 });
        }
        if (error.message === "already_rolled_back" || error.message.includes("blocked")) {
            return NextResponse.json({ error: error.message }, { status: 400 });
        }
        return NextResponse.json({ error: "Failed to rollback: " + error.message }, { status: 500 });
    }
}
