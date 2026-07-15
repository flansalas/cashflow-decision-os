// API: PATCH /api/planned-events/[id]
// Toggle isIncluded, isCritical, or edit typicalAmount + nextExpectedDate
// Changes persist to RecurringPattern table or CashAdjustment table based on ID lookup.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

interface PatchBody {
    isIncluded?: boolean;
    isCritical?: boolean;
    typicalAmount?: number;
    nextExpectedDate?: string | null;
    displayName?: string;
    cadence?: string;
    status?: string;
    origin?: string;
    direction?: string;
    type?: string;
}

export async function PATCH(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;
    const body: PatchBody = await req.json();

    if (!id) {
        return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    try {
        // ── Synthetic payroll (stored in Assumption table) ──
        if (id === "synthetic-payroll") {
            const companyId = await resolveTenant(req);
            if (!companyId) return NextResponse.json({ error: "Could not resolve company" }, { status: 400 });

            const assumptionData: Record<string, any> = {};
            if (body.typicalAmount !== undefined) assumptionData.payrollAllInAmount = body.typicalAmount;
            if (body.nextExpectedDate !== undefined) {
                assumptionData.payrollNextDate = body.nextExpectedDate ? new Date(body.nextExpectedDate) : null;
            }
            if (body.cadence !== undefined) assumptionData.payrollCadence = body.cadence;

            const existing = await prisma.assumption.findFirst({ where: { companyId } });
            if (existing) {
                await prisma.assumption.update({ where: { id: existing.id }, data: assumptionData });
            } else {
                await prisma.assumption.create({ data: { companyId, ...assumptionData } });
            }

            return NextResponse.json({
                id: "synthetic-payroll",
                displayName: body.displayName ?? "Payroll (Assumed)",
                isIncluded: true,
                isCritical: true,
                typicalAmount: body.typicalAmount,
                nextExpectedDate: body.nextExpectedDate ?? null,
                cadence: body.cadence ?? "biweekly",
                status: "active",
                origin: "system",
            });
        }

        const existingRecurring = await prisma.recurringPattern.findUnique({ where: { id } });
        if (existingRecurring) {
            const updateData: Partial<{
                isIncluded: boolean;
                isCritical: boolean;
                typicalAmount: number;
                nextExpectedDate: Date | null;
                displayName: string;
                cadence: string;
                status: string;
                origin: string;
                direction: string;
                category: string;
            }> = {};

            if (body.isIncluded !== undefined) updateData.isIncluded = body.isIncluded;
            if (body.isCritical !== undefined) updateData.isCritical = body.isCritical;
            if (body.status !== undefined) updateData.status = body.status;
            if (body.origin !== undefined) updateData.origin = body.origin;
            if (body.displayName !== undefined) updateData.displayName = body.displayName.trim();
            if (body.direction !== undefined) updateData.direction = body.direction;
            if (body.type !== undefined) updateData.category = body.type;
            if (body.typicalAmount !== undefined) {
                if (body.typicalAmount <= 0) return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
                updateData.typicalAmount = body.typicalAmount;
            }
            if (body.nextExpectedDate !== undefined) {
                updateData.nextExpectedDate = body.nextExpectedDate ? new Date(body.nextExpectedDate) : null;
            }

            let cadenceChanged = false;
            if (body.cadence !== undefined && body.cadence !== existingRecurring.cadence) {
                updateData.cadence = body.cadence;
                cadenceChanged = true;
            }

            const updated = await prisma.recurringPattern.update({ where: { id }, data: updateData });

            if (cadenceChanged) {
                await prisma.override.updateMany({
                    where: { targetId: id, status: "active", type: { in: ["skip_recurring_occurrence", "add_one_time_outflow"] } },
                    data: { status: "archived" }
                });
            }

            return NextResponse.json({
                id: updated.id,
                displayName: updated.displayName,
                isIncluded: updated.isIncluded,
                isCritical: updated.isCritical,
                typicalAmount: updated.typicalAmount,
                nextExpectedDate: updated.nextExpectedDate,
                cadence: updated.cadence,
                status: updated.status,
                origin: updated.origin,
            });
        }

        const existingAdjustment = await prisma.cashAdjustment.findUnique({ where: { id } });
        if (existingAdjustment) {
            const updateData: any = {};
            if (body.displayName !== undefined) updateData.note = body.displayName.trim();
            if (body.type !== undefined) updateData.type = body.type;
            if (body.status !== undefined) updateData.status = body.status;
            if (body.origin !== undefined) updateData.origin = body.origin;
            if (body.typicalAmount !== undefined && body.direction !== undefined) {
                updateData.amount = body.direction === "outflow" ? -Math.abs(body.typicalAmount) : Math.abs(body.typicalAmount);
            } else if (body.typicalAmount !== undefined) {
                updateData.amount = existingAdjustment.amount < 0 ? -Math.abs(body.typicalAmount) : Math.abs(body.typicalAmount);
            } else if (body.direction !== undefined) {
                updateData.amount = body.direction === "outflow" ? -Math.abs(existingAdjustment.amount) : Math.abs(existingAdjustment.amount);
            }
            if (body.nextExpectedDate !== undefined) updateData.date = body.nextExpectedDate ? body.nextExpectedDate : new Date().toISOString().slice(0, 10);

            const updated = await prisma.cashAdjustment.update({ where: { id }, data: updateData });
            return NextResponse.json({ ok: true, updated });
        }

        return NextResponse.json({ error: "Planned event not found" }, { status: 404 });
    } catch (error) {
        console.error("Planned Events PATCH error:", error);
        return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    try {
        if (id === "synthetic-payroll") {
            return NextResponse.json({ error: "Payroll (Assumed) is derived from your assumptions and cannot be deleted here. Edit or clear it via Setup." }, { status: 400 });
        }

        const existingRecurring = await prisma.recurringPattern.findUnique({ where: { id } });
        if (existingRecurring) {
            await prisma.recurringPattern.delete({ where: { id } });
            await prisma.override.updateMany({
                where: { targetId: id, status: "active", type: { in: ["skip_recurring_occurrence", "add_one_time_outflow"] } },
                data: { status: "archived" }
            });
            return NextResponse.json({ ok: true });
        }

        const existingAdjustment = await prisma.cashAdjustment.findUnique({ where: { id } });
        if (existingAdjustment) {
            await prisma.cashAdjustment.delete({ where: { id } });
            return NextResponse.json({ ok: true });
        }

        return NextResponse.json({ error: "Not found" }, { status: 404 });
    } catch (error) {
        console.error("Planned Events DELETE error:", error);
        return NextResponse.json({ error: "Failed to delete event" }, { status: 500 });
    }
}

