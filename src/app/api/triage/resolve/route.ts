// POST /api/triage/resolve
// Bulk-resolves slipped items from the Week Roll triage drawer.
// Each action can be:
//   { id, kind: "ar"|"ap", action: "snooze", weekStart: ISO string }  → creates/updates an override to reschedule
//   { id, kind: "ar"|"ap", action: "mark_paid" }                       → creates a mark_paid override
//   { id, kind: "ar"|"ap", action: "dismiss" }                         → no change (user acknowledges, leaves in backlog)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { recordCustomerPaymentObservation, recordVendorPaymentObservation } from "@/services/payment-memory";
import { logAuditEvent } from "@/services/audit";
import { resolveForecastHashAfter } from "@/services/forecast-hash";

type TriageAction = {
    id: string;
    kind: "ar" | "ap";
    action: "snooze" | "mark_paid" | "dismiss";
    weekStart?: string; // ISO — required when action === "snooze"
};

export async function POST(req: NextRequest) {
    const { companyId, actions } = await req.json() as {
        companyId: string;
        actions: TriageAction[];
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!actions?.length) return NextResponse.json({ ok: true, resolved: 0 });

    let resolved = 0;
    let snoozed = 0;
    let markedPaid = 0;

    let lastChangeLogId: string | null = null;

    let userId = null;
    try {
        const authResult = await auth();
        userId = authResult?.userId ?? null;
    } catch {}

    for (const a of actions) {
        if (a.action === "dismiss") {
            // Nothing to do — item stays open, user has acknowledged it
            resolved++;
            continue;
        }

        if (a.action === "mark_paid") {
            // Deactivate any existing mark_paid for this target first
            await prisma.override.updateMany({
                where: { companyId, targetId: a.id, type: "mark_paid", status: "active" },
                data: { status: "superseded" },
            });
            const effectiveDate = new Date();
            await prisma.override.create({
                data: {
                    companyId,
                    targetId: a.id,
                    targetType: a.kind === "ar" ? "receivable_invoice" : "payable_bill",
                    type: "mark_paid",
                    status: "active",
                    effectiveDate,
                },
            });

            // Observations & Audit
            if (a.kind === "ar") {
                const inv = await prisma.receivableInvoice.findUnique({ where: { id: a.id } });
                if (inv) {
                    await recordCustomerPaymentObservation({
                        companyId,
                        customerName: inv.customerName,
                        invoiceId: inv.id,
                        invoiceNo: inv.invoiceNo,
                        dueDate: inv.dueDate,
                        expectedPaymentDate: null,
                        actualPaymentDate: effectiveDate,
                        amount: inv.amountOpen,
                        paymentSource: "manual_verified",
                    });
                }
            } else {
                const bill = await prisma.payableBill.findUnique({ where: { id: a.id } });
                if (bill) {
                    await recordVendorPaymentObservation({
                        companyId,
                        vendorName: bill.vendorName,
                        billId: bill.id,
                        billNo: bill.billNo,
                        dueDate: bill.dueDate,
                        plannedPaymentDate: null,
                        actualPaymentDate: effectiveDate,
                        amount: bill.amountOpen,
                        paymentSource: "manual_verified",
                    });
                }
            }

            const logResult = await logAuditEvent({
                companyId,
                targetId: a.id,
                targetType: a.kind === "ar" ? "invoice" : "bill",
                action: "Marked Paid",
                source: "user",
                userId,
                fieldChanged: "status",
                oldValue: "open",
                newValue: "paid",
                reasoning: "User resolved triage backlog",
            });
            lastChangeLogId = logResult.id;

            markedPaid++;
            resolved++;
        }

        if (a.action === "snooze" && a.weekStart) {
            const newDate = new Date(a.weekStart);
            const overrideType = a.kind === "ar" ? "set_expected_payment_date" : "delay_due_date";
            const targetType = a.kind === "ar" ? "receivable_invoice" : "payable_bill";

            // Supersede any existing date override for this item
            await prisma.override.updateMany({
                where: { companyId, targetId: a.id, type: overrideType, status: "active" },
                data: { status: "superseded" },
            });

            await prisma.override.create({
                data: {
                    companyId,
                    targetId: a.id,
                    targetType,
                    type: overrideType,
                    status: "active",
                    effectiveDate: newDate,
                },
            });

            const logResult = await logAuditEvent({
                companyId,
                targetId: a.id,
                targetType: a.kind === "ar" ? "invoice" : "bill",
                action: a.kind === "ar" ? "Expected Date Moved" : "Due Date Delayed",
                source: "user",
                userId,
                fieldChanged: a.kind === "ar" ? "expectedDate" : "effectiveDate",
                oldValue: "slipped",
                newValue: newDate.toISOString(),
                reasoning: "User snoozed triage backlog",
            });
            lastChangeLogId = logResult.id;

            snoozed++;
            resolved++;
        }
    }

    if (lastChangeLogId) {
        await resolveForecastHashAfter(companyId, lastChangeLogId);
    }

    return NextResponse.json({ ok: true, resolved, snoozed, markedPaid });
}
