// API: PATCH /api/cash-entries/[id]  — Update an entry
// API: DELETE /api/cash-entries/[id] — Delete an entry

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json();

    try {
        const updated = await prisma.cashFlowEntry.update({
            where: { id },
            data: {
                ...(body.label !== undefined && { label: body.label.trim() }),
                ...(body.amount !== undefined && { amount: body.amount }),
                ...(body.weekNumber !== undefined && { weekNumber: body.weekNumber }),
                ...(body.note !== undefined && { note: body.note?.trim() || null }),
                ...(body.categoryId !== undefined && { categoryId: body.categoryId }),
            },
            include: { category: true },
        });
        return NextResponse.json(updated);
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
