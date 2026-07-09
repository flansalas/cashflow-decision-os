import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export async function PATCH(req: NextRequest) {
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

        if (body.bulkAction) {
            const { batchId, action } = body;
            if (!batchId || !action) return NextResponse.json({ error: "Missing params" }, { status: 400 });

            if (action === "skip_exact_duplicates") {
                await prisma.stagedImportRow.updateMany({
                    where: { companyId: tenantId, importBatchId: batchId, conflictType: "exact_duplicate", userDecision: null },
                    data: { userDecision: "skip", reviewedBy: userId, reviewedAt: new Date() }
                });
            } else if (action === "accept_new_valid") {
                await prisma.stagedImportRow.updateMany({
                    where: { companyId: tenantId, importBatchId: batchId, conflictType: "new", validationStatus: "valid", userDecision: null },
                    data: { userDecision: "accept_insert", reviewedBy: userId, reviewedAt: new Date() }
                });
            } else {
                return NextResponse.json({ error: "Invalid bulk action" }, { status: 400 });
            }
            return NextResponse.json({ ok: true });
        } else {
            const { rowId, decision, note, linkedRecordId } = body;
            if (!rowId || !decision) return NextResponse.json({ error: "Missing rowId or decision" }, { status: 400 });

            const row = await prisma.stagedImportRow.findFirst({
                where: { id: rowId, companyId: tenantId }
            });
            if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });

            // Validate decision based on conflict type
            const type = row.conflictType;
            let valid = false;

            if (row.importType === "bank") {
                if (type === "new") valid = ["accept_insert", "skip"].includes(decision);
                else if (type === "exact_duplicate") valid = decision === "skip";
                else if (type === "possible_duplicate") valid = ["accept_insert", "skip"].includes(decision);
                else if (type === "invalid") valid = decision === "skip";
            } else {
                if (type === "new") valid = ["accept_insert", "skip"].includes(decision);
                else if (type === "exact_duplicate") valid = decision === "skip";
                else if (type === "changed_existing") valid = ["accept_update", "keep_existing", "skip"].includes(decision);
                else if (type === "possible_match") valid = ["link_and_review", "treat_as_new", "skip"].includes(decision);
                else if (type === "invalid") valid = decision === "skip";
            }

            if (!valid) {
                return NextResponse.json({ error: "Invalid decision for this conflict type" }, { status: 400 });
            }

            let finalLinkedRecordId = row.matchedRecordId;

            if (decision === "link_and_review") {
                if (!linkedRecordId) {
                    return NextResponse.json({ error: "linkedRecordId is required for link_and_review" }, { status: 400 });
                }

                // Validate tenant ownership and correct entity type
                if (row.importType === "ar") {
                    const invoice = await prisma.receivableInvoice.findFirst({ where: { id: linkedRecordId, companyId: tenantId } });
                    if (!invoice) return NextResponse.json({ error: "Invalid or cross-tenant linkedRecordId for AR" }, { status: 400 });
                } else if (row.importType === "ap") {
                    const bill = await prisma.payableBill.findFirst({ where: { id: linkedRecordId, companyId: tenantId } });
                    if (!bill) return NextResponse.json({ error: "Invalid or cross-tenant linkedRecordId for AP" }, { status: 400 });
                } else {
                    return NextResponse.json({ error: "link_and_review not supported for bank" }, { status: 400 });
                }
                finalLinkedRecordId = linkedRecordId;
            } else if (decision === "treat_as_new" || decision === "skip") {
                finalLinkedRecordId = null; // Clear linkedRecordId
            }

            await prisma.stagedImportRow.update({
                where: { id: row.id },
                data: {
                    userDecision: decision,
                    reviewNote: note || null,
                    reviewedBy: userId,
                    reviewedAt: new Date(),
                    linkedRecordId: finalLinkedRecordId
                }
            });

            return NextResponse.json({ ok: true });
        }
    } catch (error) {
        console.error("Decision API error:", error);
        return NextResponse.json({ error: "Failed to apply decision" }, { status: 500 });
    }
}
