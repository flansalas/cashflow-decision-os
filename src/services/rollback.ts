import prisma from "../db/prisma";

export async function checkRollbackEligibility(tenantId: string, applicationId: string) {
    const application = await prisma.importApplication.findFirst({
        where: { id: applicationId, companyId: tenantId },
        include: { changes: true }
    });

    if (!application) throw new Error("application_not_found");
    if (application.status === "rolled_back") throw new Error("already_rolled_back");

    for (const change of application.changes) {
        if (change.operation === "update") {
            // Check update safety
            let currentRecord: any = null;
            if (change.entityType === "ar") {
                currentRecord = await prisma.receivableInvoice.findUnique({ where: { id: change.entityId } });
            } else if (change.entityType === "ap") {
                currentRecord = await prisma.payableBill.findUnique({ where: { id: change.entityId } });
            }

            if (!currentRecord) throw new Error(`Row ${change.stagedRowId} blocked: Record not found`);

            const changedFields = JSON.parse(change.changedFieldsJson);
            for (const key of Object.keys(changedFields)) {
                let curVal = currentRecord[key];
                let expectedAfter = changedFields[key].after;

                if (curVal instanceof Date) curVal = curVal.getTime();
                if (typeof curVal === "string" && curVal.match(/^\d{4}-\d{2}-\d{2}T/)) {
                    curVal = new Date(curVal).getTime();
                }

                if (typeof expectedAfter === "string" && expectedAfter.match(/^\d{4}-\d{2}-\d{2}T/)) {
                    expectedAfter = new Date(expectedAfter).getTime();
                } else if (expectedAfter instanceof Date) {
                    expectedAfter = expectedAfter.getTime();
                }

                if (curVal !== expectedAfter) {
                    throw new Error(`Row ${change.stagedRowId} blocked: Field ${key} modified after import`);
                }
            }
        } else if (change.operation === "insert") {
            // Check insert safety
            let currentRecord: any = null;
            if (change.entityType === "ar") {
                currentRecord = await prisma.receivableInvoice.findUnique({ where: { id: change.entityId } });
                const obs = await prisma.customerPaymentObservation.findFirst({ where: { invoiceId: change.entityId }});
                if (obs) throw new Error(`Row ${change.stagedRowId} blocked: Dependent activity exists`);
            } else if (change.entityType === "ap") {
                currentRecord = await prisma.payableBill.findUnique({ where: { id: change.entityId } });
                const obs = await prisma.vendorPaymentObservation.findFirst({ where: { billId: change.entityId }});
                if (obs) throw new Error(`Row ${change.stagedRowId} blocked: Dependent activity exists`);
            } else if (change.entityType === "bank") {
                currentRecord = await prisma.bankTransaction.findUnique({ where: { id: change.entityId } });
                // Assuming no payment observations for bank directly in this schema for now
            }

            if (!currentRecord) {
                throw new Error(`Row ${change.stagedRowId} blocked: Record not found`);
            }

            const afterJson = JSON.parse(change.afterJson);

            if (change.entityType === "bank") {
                // Compare mutable fields
                if (currentRecord.amount !== afterJson.amount) {
                    throw new Error(`Row ${change.stagedRowId} blocked: Inserted record was modified later`);
                }
                if (currentRecord.description !== afterJson.description) {
                    throw new Error(`Row ${change.stagedRowId} blocked: Inserted record was modified later`);
                }
                if (currentRecord.direction !== afterJson.direction) {
                    throw new Error(`Row ${change.stagedRowId} blocked: Inserted record was modified later`);
                }
                if (currentRecord.accountId !== afterJson.accountId) {
                    throw new Error(`Row ${change.stagedRowId} blocked: Inserted record was modified later`);
                }
                if (currentRecord.txHash !== afterJson.txHash) {
                    throw new Error(`Row ${change.stagedRowId} blocked: Inserted record was modified later`);
                }
                const curTime = new Date(currentRecord.txDate).getTime();
                const afterTime = new Date(afterJson.txDate).getTime();
                if (curTime !== afterTime) {
                    throw new Error(`Row ${change.stagedRowId} blocked: Inserted record was modified later`);
                }
            }

            // Check if updated after
            if (currentRecord.updatedAt) {
                const curUpdated = new Date(currentRecord.updatedAt).getTime();
                const afterUpdated = new Date(afterJson.updatedAt).getTime();
                // If updatedAt differs by more than 1 second (to allow DB truncation diffs)
                if (Math.abs(curUpdated - afterUpdated) > 1000) {
                    throw new Error(`Row ${change.stagedRowId} blocked: Inserted record was modified later`);
                }
            }
        }
    }

    return true;
}
