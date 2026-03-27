// app/api/overrides/route.ts – POST: create a new override
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

const VALID_TYPES = [
    "partial_payment", "mark_paid", "delay_due_date",
    "adjust_amount", "add_one_time_outflow", "add_one_time_inflow",
    "set_expected_payment_date", "set_bill_due_date",
    "set_customer_delay", "set_vendor_criticality",
    "set_recurring_pattern", "toggle_recurring_included",
    "set_payroll", "set_rent", "set_fixed_outflow", "add_cash_adjustment",
    "skip_recurring_occurrence",
];

export async function POST(req: NextRequest) {
    const body = await req.json() as {
        companyId: string;
        type: string;
        targetType: string;
        targetId?: string;
        amount?: number;
        effectiveDate?: string;
        metaJson?: string;
    };

    const { companyId, type, targetType: rawTargetType, targetId, amount, effectiveDate, metaJson } = body;

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!VALID_TYPES.includes(type)) return NextResponse.json({ error: "Invalid override type" }, { status: 400 });
    if (!rawTargetType) return NextResponse.json({ error: "Missing targetType" }, { status: 400 });

    // Map frontend types to DB-internal targetType strings
    const targetType = rawTargetType === "invoice" ? "receivable_invoice" :
                       rawTargetType === "bill" ? "payable_bill" :
                       rawTargetType;

    const created = await prisma.override.create({
        data: {
            id: uuidv4(),
            companyId,
            type,
            targetType,
            targetId: targetId ?? null,
            amount: amount ?? null,
            effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
            metaJson: metaJson ?? null,
            status: "active",
        },
    });

    return NextResponse.json({ id: created.id, ok: true });
}

export async function DELETE(req: NextRequest) {
    const targetId = req.nextUrl.searchParams.get("targetId");
    const rawType = req.nextUrl.searchParams.get("type");

    if (!targetId || !rawType) {
        return NextResponse.json({ error: "targetId and type are required" }, { status: 400 });
    }

    // Support both the original and mapped types for deletion to ensure history cleanup
    const types = [rawType];
    if (rawType === "delay_due_date") types.push("set_bill_due_date");
    if (rawType === "set_bill_due_date") types.push("delay_due_date");

    await prisma.override.updateMany({
        where: { 
            targetId, 
            type: { in: types },
            status: "active" 
        },
        data: { status: "archived" },
    });

    return NextResponse.json({ ok: true });
}
