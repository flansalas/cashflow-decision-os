// API: PATCH /api/cash-entries/[id]  — Update an entry
// API: DELETE /api/cash-entries/[id] — Delete an entry

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json();

    let targetDate: Date | undefined;
    if (body.weekNumber !== undefined) {
        const today = new Date();
        const monday = new Date();
        const day = today.getDay();
        const diff = (day === 0 ? -6 : 1 - day);
        monday.setDate(today.getDate() + diff);
        monday.setHours(0, 0, 0, 0);
        targetDate = new Date(monday);
        targetDate.setDate(targetDate.getDate() + (body.weekNumber - 1) * 7);
    }

    try {
        const updated = await prisma.cashFlowEntry.update({
            where: { id },
            data: {
                ...(body.label !== undefined && { label: body.label.trim() }),
                ...(body.amount !== undefined && { amount: body.amount }),
                ...(targetDate !== undefined && { targetDate }),
                ...(body.note !== undefined && { note: body.note?.trim() || null }),
                ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
            },
            include: { category: true },
        });
        return NextResponse.json({ ...updated, weekNumber: body.weekNumber });
    } catch (error) {
        console.error("Update entry error:", error);
        return NextResponse.json({ error: "Failed to update entry" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    try {
        await prisma.cashFlowEntry.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Delete entry error:", error);
        return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 });
    }
}
