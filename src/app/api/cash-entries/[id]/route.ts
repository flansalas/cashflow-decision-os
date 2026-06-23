// API: PATCH /api/cash-entries/[id]  — Update an entry
// API: DELETE /api/cash-entries/[id] — Delete an entry

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

/** Mirrors forecast.ts getMonday — returns UTC-midnight Monday for a given date. */
function getMondayUTC(d: Date): Date {
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1 - day);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json();

    let targetDate: Date | undefined;
    if (body.weekNumber !== undefined) {
        // Use the same Monday the forecast uses: getMonday(cashSnapshot.asOfDate)
        // First find the entry to get companyId, then look up the snapshot
        const entry = await prisma.cashFlowEntry.findUnique({ where: { id }, select: { companyId: true } });
        const snapshot = entry
            ? await prisma.cashSnapshot.findFirst({ where: { companyId: entry.companyId }, orderBy: { asOfDate: "desc" } })
            : null;
        const baseMonday = snapshot ? getMondayUTC(new Date(snapshot.asOfDate)) : getMondayUTC(new Date());
        targetDate = new Date(baseMonday.getTime() + (body.weekNumber - 1) * 7 * 24 * 60 * 60 * 1000);
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
