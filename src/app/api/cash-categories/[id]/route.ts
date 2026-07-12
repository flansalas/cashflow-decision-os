// API: PATCH /api/cash-categories/[id]  — Update a category
// API: DELETE /api/cash-categories/[id] — Delete a category (cascade entries)

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const authResult = await auth();
    if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();

    try {
        const existing = await prisma.cashFlowCategory.findFirst({ where: { id, companyId: tenantId } });
        if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

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
    const authResult = await auth();
    if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    try {
        const existing = await prisma.cashFlowCategory.findFirst({ where: { id, companyId: tenantId } });
        if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

        await prisma.cashFlowEntry.deleteMany({ where: { categoryId: id } });
        await prisma.cashFlowCategory.delete({ where: { id } });
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Delete category error:", error);
        return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
    }
}
