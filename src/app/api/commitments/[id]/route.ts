// API: PATCH /api/commitments/[id]
// Toggle isIncluded, isCritical, or edit typicalAmount + nextExpectedDate
// Changes persist to RecurringPattern table.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

interface PatchBody {
    isIncluded?: boolean;
    isCritical?: boolean;
    typicalAmount?: number;
    nextExpectedDate?: string | null;
    displayName?: string;
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
        const existing = await prisma.recurringPattern.findUnique({ where: { id } });
        if (!existing) {
            return NextResponse.json({ error: "Recurring pattern not found" }, { status: 404 });
        }

        const updateData: Partial<{
            isIncluded: boolean;
            isCritical: boolean;
            typicalAmount: number;
            nextExpectedDate: Date | null;
            displayName: string;
        }> = {};

        if (body.isIncluded !== undefined) updateData.isIncluded = body.isIncluded;
        if (body.isCritical !== undefined) updateData.isCritical = body.isCritical;
        if (body.displayName !== undefined) updateData.displayName = body.displayName.trim();
        if (body.typicalAmount !== undefined) {
            if (body.typicalAmount <= 0) {
                return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
            }
            updateData.typicalAmount = body.typicalAmount;
        }
        if (body.nextExpectedDate !== undefined) {
            updateData.nextExpectedDate = body.nextExpectedDate ? new Date(body.nextExpectedDate) : null;
        }

        const updated = await prisma.recurringPattern.update({
            where: { id },
            data: updateData,
        });

        return NextResponse.json({
            id: updated.id,
            displayName: updated.displayName,
            isIncluded: updated.isIncluded,
            isCritical: updated.isCritical,
            typicalAmount: updated.typicalAmount,
            nextExpectedDate: updated.nextExpectedDate,
        });
    } catch (error) {
        console.error("Commitments PATCH error:", error);
        return NextResponse.json({ error: "Failed to update commitment" }, { status: 500 });
    }
}

export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    try {
        const existing = await prisma.recurringPattern.findUnique({ where: { id } });
        if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

        await prisma.recurringPattern.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Commitments DELETE error:", error);
        return NextResponse.json({ error: "Failed to delete commitment" }, { status: 500 });
    }
}

