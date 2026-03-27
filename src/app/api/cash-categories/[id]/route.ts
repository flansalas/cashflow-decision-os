// API: PATCH /api/cash-categories/[id]  — Update a category
// API: DELETE /api/cash-categories/[id] — Delete a category (cascade entries)

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json();

    try {
        const updated = await prisma.cashFlowCategory.update({
            where: { id },
            data: {
                ...(body.name !== undefined && { name: body.name.trim() }),
                ...(body.sortOrder !== undefined && { sortOrder: body.sortOrder }),
            },
        });
        return NextResponse.json(updated);
    } catch (error) {
        console.error("Update category error:", error);
        return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    try {
        await prisma.cashFlowEntry.deleteMany({ where: { categoryId: id } });
        await prisma.cashFlowCategory.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Delete category error:", error);
        return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
    }
}
