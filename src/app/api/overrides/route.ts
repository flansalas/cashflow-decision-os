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
    "skip_recurring_occurrence", "exclude"
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

    // 1. Check for existing active overrides to prevent duplicates and find oldValue
    const existingOverrides = await prisma.override.findMany({
        where: { companyId, targetId: targetId ?? null, type, status: "active" }
    });

    let oldValue: string | number | null = null;

    if (existingOverrides.length > 0) {
        const exactMatch = existingOverrides.find(o => 
            (o.amount === (amount ?? null)) && 
            (o.effectiveDate?.getTime() === (effectiveDate ? new Date(effectiveDate).getTime() : undefined))
        );
        if (exactMatch) {
            return NextResponse.json({ id: exactMatch.id, ok: true }); // No-op for exact duplicate
        }

        const current = existingOverrides[0];
        if (type.includes("date") || type === "delay_due_date") {
            oldValue = current.effectiveDate ? current.effectiveDate.toISOString() : null;
        } else if (type === "adjust_amount") {
            oldValue = current.amount;
        } else if (type === "exclude") {
            oldValue = "excluded";
        }

        // Archive old overrides to avoid stacking
        await prisma.override.updateMany({
            where: { companyId, targetId: targetId ?? null, type, status: "active" },
            data: { status: "archived" }
        });
    }

    if (existingOverrides.length === 0 && targetId) {
        if (targetType === "receivable_invoice") {
            const inv = await prisma.receivableInvoice.findUnique({ where: { id: targetId } });
            if (inv) {
                if (type === "set_expected_payment_date") oldValue = inv.dueDate ? inv.dueDate.toISOString() : null;
                if (type === "adjust_amount") oldValue = inv.amountOpen;
                if (type === "exclude") oldValue = inv.status;
            }
        } else if (targetType === "payable_bill") {
            const bill = await prisma.payableBill.findUnique({ where: { id: targetId } });
            if (bill) {
                if (type === "set_bill_due_date" || type === "delay_due_date") oldValue = bill.dueDate ? bill.dueDate.toISOString() : null;
                if (type === "adjust_amount") oldValue = bill.amountOpen;
                if (type === "exclude") oldValue = bill.status;
            }
        } else if (targetType === "recurring_pattern") {
            const rp = await prisma.recurringPattern.findUnique({ where: { id: targetId } });
            if (rp) {
                if (type === "adjust_amount") oldValue = rp.typicalAmount;
            }
        }
    }

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

    let actionDesc = type.replace(/_/g, ' ');
    let fieldChanged = "unknown";
    let newValue: string | number | null = null;

    if (type === "set_expected_payment_date" && effectiveDate) {
        actionDesc = `Expected Date Moved`;
        fieldChanged = "expectedDate";
        newValue = effectiveDate;
    } else if (type === "set_bill_due_date" && effectiveDate) {
        actionDesc = `Due Date Delayed`;
        fieldChanged = "effectiveDate";
        newValue = effectiveDate;
    } else if (type === "adjust_amount" && amount !== undefined) {
        actionDesc = `Amount Adjusted`;
        fieldChanged = "amountOpen";
        newValue = amount;
    } else if (type === "delay_due_date") {
        actionDesc = `Delayed payment due date`;
        fieldChanged = "dueDate";
    } else if (type === "exclude") {
        actionDesc = `Excluded Permanently`;
        fieldChanged = "status";
        newValue = "excluded";
    }

    try {
        const { logAuditEvent } = await import("@/services/audit");
        await logAuditEvent({
            companyId,
            targetId: targetId || "unknown",
            targetType: rawTargetType as any,
            action: actionDesc,
            source: "user",
            fieldChanged,
            oldValue,
            newValue,
            reasoning: "User override via drawer"
        });
    } catch (e) {
        console.error("Audit log failed for POST override:", e);
    }

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

    const existing = await prisma.override.findFirst({
        where: { targetId, type: { in: types }, status: "active" }
    });

    await prisma.override.updateMany({
        where: { 
            targetId, 
            type: { in: types },
            status: "active" 
        },
        data: { status: "archived" },
    });

    if (existing) {
        let oldValue: string | number | null = null;
        if (existing.type.includes("date") || existing.type === "delay_due_date") {
            oldValue = existing.effectiveDate ? existing.effectiveDate.toISOString() : null;
        } else if (existing.type === "adjust_amount") {
            oldValue = existing.amount;
        } else if (existing.type === "exclude") {
            oldValue = "excluded";
        }

        try {
            const { logAuditEvent } = await import("@/services/audit");
            const mappedTargetType = existing.targetType === "receivable_invoice" ? "invoice" : 
                                     existing.targetType === "payable_bill" ? "bill" : 
                                     existing.targetType;
            await logAuditEvent({
                companyId: existing.companyId,
                targetId: targetId || "unknown",
                targetType: mappedTargetType as any,
                action: `Removed ${existing.type.replace(/_/g, ' ')}`,
                source: "user",
                fieldChanged: "override",
                oldValue,
                newValue: "removed",
                reasoning: "User restored original value"
            });
        } catch (e) {
            console.error("Audit log failed for DELETE override:", e);
        }
    }

    return NextResponse.json({ ok: true });
}
