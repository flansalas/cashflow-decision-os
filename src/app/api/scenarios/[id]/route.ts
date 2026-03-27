// app/api/scenarios/[id]/route.ts – PATCH (edit) and DELETE a scenario item
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function PATCH(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;
    const { label, direction, weekNumber, amount } = await req.json() as {
        label?: string;
        direction?: "in" | "out";
        weekNumber?: number;
        amount?: number;
    };

    const existing = await prisma.scenarioItem.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (direction && !["in", "out"].includes(direction))
        return NextResponse.json({ error: "Invalid direction" }, { status: 400 });
    if (weekNumber !== undefined && (weekNumber < 1 || weekNumber > 13))
        return NextResponse.json({ error: "Week must be 1-13" }, { status: 400 });
    if (amount !== undefined && amount <= 0)
        return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });

    const updated = await prisma.scenarioItem.update({
        where: { id },
        data: {
            ...(label !== undefined ? { label: label.trim() } : {}),
            ...(direction !== undefined ? { direction } : {}),
            ...(weekNumber !== undefined ? { weekNumber } : {}),
            ...(amount !== undefined ? { amount } : {}),
        },
    });

    return NextResponse.json({
        id: updated.id, label: updated.label,
        direction: updated.direction as "in" | "out",
        weekNumber: updated.weekNumber, amount: updated.amount,
    });
}

export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const { id } = await context.params;
    const existing = await prisma.scenarioItem.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.scenarioItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
}
