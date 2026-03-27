// GET /api/triage?companyId=xxx
// Returns open AR invoices and AP bills whose expected/due date is before today.
// These are "slipped" items — they were forecast to pay/receive last week but didn't.
// Used by the Week Roll ritual Triage Drawer.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import {
    computeExpectedPaymentDate,
    parsePaymentCurve,
    getMonday,
    addWeeks,
    addDays,
} from "@/services/forecast";

export async function GET(req: NextRequest) {
    const companyId = req.nextUrl.searchParams.get("companyId");
    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

    const today = new Date();

    const [
        invoices,
        bills,
        customerProfiles,
        overrides,
        assumptionRaw,
    ] = await Promise.all([
        prisma.receivableInvoice.findMany({ where: { companyId, status: "open" } }),
        prisma.payableBill.findMany({ where: { companyId, status: "open" } }),
        prisma.customerProfile.findMany({ where: { companyId } }),
        prisma.override.findMany({ where: { companyId, status: "active" } }),
        prisma.assumption.findFirst({ where: { companyId } }),
    ]);

    const paymentCurve = parsePaymentCurve(
        assumptionRaw?.paymentCurveJson ?? '{"current":0,"1-14":1,"15-30":2,"31-60":3,"61+":4}'
    );
    const customerMap = new Map(customerProfiles.map(c => [c.customerName, c]));
    const overridesByTarget = new Map<string, typeof overrides>();
    for (const ov of overrides) {
        if (ov.targetId) {
            if (!overridesByTarget.has(ov.targetId)) overridesByTarget.set(ov.targetId, []);
            overridesByTarget.get(ov.targetId)!.push(ov);
        }
    }

    const currentMonday = getMonday(today);

    // ── Slipped AR invoices ───────────────────────────────────────────────────
    const slippedAR: Array<{
        id: string; kind: "ar";
        label: string; subLabel: string;
        amount: number; expectedDate: string;
        confidence: string;
    }> = [];

    for (const inv of invoices) {
        const ovs = overridesByTarget.get(inv.id) || [];
        if (ovs.some(o => o.type === "mark_paid")) continue;

        const overrideExpectedDate = ovs.find(o => o.type === "set_expected_payment_date")?.effectiveDate ?? null;
        const cp = customerMap.get(inv.customerName);

        const { date: expectedDate, confidence } = computeExpectedPaymentDate(
            {
                id: inv.id,
                customerName: inv.customerName,
                invoiceNo: inv.invoiceNo,
                amountOpen: inv.amountOpen,
                invoiceDate: inv.invoiceDate,
                dueDate: inv.dueDate,
                daysPastDue: inv.daysPastDue,
                status: inv.status,
                metaJson: inv.metaJson,
                typicalDelayWeeks: cp?.typicalDelayWeeks,
                riskTag: cp?.riskTag,
                overrideExpectedDate: overrideExpectedDate ? new Date(overrideExpectedDate) : null,
            },
            today,
            paymentCurve,
        );

        // Only include if expected date is before today's Monday (i.e., it was in a past week)
        if (expectedDate < currentMonday) {
            slippedAR.push({
                id: inv.id,
                kind: "ar",
                label: `${inv.customerName} — ${inv.invoiceNo}`,
                subLabel: `Invoice · $${inv.amountOpen.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
                amount: inv.amountOpen,
                expectedDate: expectedDate.toISOString(),
                confidence,
            });
        }
    }

    // ── Slipped AP bills ──────────────────────────────────────────────────────
    const slippedAP: Array<{
        id: string; kind: "ap";
        label: string; subLabel: string;
        amount: number; expectedDate: string;
    }> = [];

    for (const bill of bills) {
        const ovs = overridesByTarget.get(bill.id) || [];
        if (ovs.some(o => o.type === "mark_paid")) continue;

        const overrideDueDate = ovs.find(o => o.type === "delay_due_date" || o.type === "set_bill_due_date")?.effectiveDate ?? null;

        let billDueDate: Date;
        if (overrideDueDate) {
            billDueDate = new Date(overrideDueDate);
        } else if (bill.dueDate) {
            billDueDate = new Date(bill.dueDate);
        } else if (bill.billDate) {
            billDueDate = addDays(new Date(bill.billDate), 30);
        } else {
            billDueDate = addDays(today, 7);
        }

        if (billDueDate < currentMonday) {
            slippedAP.push({
                id: bill.id,
                kind: "ap",
                label: `${bill.vendorName} — ${bill.billNo}`,
                subLabel: `Bill · $${bill.amountOpen.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`,
                amount: bill.amountOpen,
                expectedDate: billDueDate.toISOString(),
            });
        }
    }

    // Build suggested week options (next 4 weeks)
    const weekOptions = Array.from({ length: 4 }, (_, i) => {
        const weekStart = addWeeks(currentMonday, i);
        const weekEnd = addDays(weekStart, 6);
        return {
            weekNumber: i + 1,
            label: `W${i + 1} — ${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} to ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
            weekStart: weekStart.toISOString(),
        };
    });

    return NextResponse.json({
        slippedAR,
        slippedAP,
        weekOptions,
        total: slippedAR.length + slippedAP.length,
    });
}
