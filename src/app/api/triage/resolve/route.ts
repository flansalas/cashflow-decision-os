// POST /api/triage/resolve
// Bulk-resolves slipped items from the Week Roll triage drawer.
// Each action can be:
//   { id, kind: "ar"|"ap", action: "snooze", weekStart: ISO string }  → creates/updates an override to reschedule
//   { id, kind: "ar"|"ap", action: "mark_paid" }                       → creates a mark_paid override
//   { id, kind: "ar"|"ap", action: "dismiss" }                         → no change (user acknowledges, leaves in backlog)

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

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
            await prisma.override.create({
                data: {
                    companyId,
                    targetId: a.id,
                    targetType: a.kind === "ar" ? "receivable_invoice" : "payable_bill",
                    type: "mark_paid",
                    status: "active",
                    effectiveDate: new Date(),
                },
            });
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
            snoozed++;
            resolved++;
        }
    }

    return NextResponse.json({ ok: true, resolved, snoozed, markedPaid });
}
