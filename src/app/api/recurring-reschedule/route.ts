// POST /api/recurring-reschedule
// Atomically reschedules one occurrence of a recurring commitment:
//   1. Creates a skip_recurring_occurrence override for the source week
//   2. Creates an add_one_time_outflow override for the target week
// This is non-destructive: the original RecurringPattern rule is unchanged.
// Both overrides can be individually deleted to undo the move.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
    const body = await req.json() as {
        companyId: string;
        patternId: string;
        displayName: string;
        amount: number;
        /** ISO date string for the week-start being vacated (the Monday of source week) */
        sourceWeekStart: string;
        /** ISO date string for the week-start to move to (the Monday of target week) */
        targetWeekStart: string;
    };

    const { companyId, patternId, displayName, amount, sourceWeekStart, targetWeekStart } = body;

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!patternId) return NextResponse.json({ error: "Missing patternId" }, { status: 400 });
    if (!sourceWeekStart || !targetWeekStart) return NextResponse.json({ error: "Missing week dates" }, { status: 400 });
    if (!amount || amount <= 0) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    if (sourceWeekStart === targetWeekStart) return NextResponse.json({ error: "Source and target weeks are the same" }, { status: 400 });

    // Verify the pattern belongs to this company
    const pattern = await prisma.recurringPattern.findFirst({ where: { id: patternId, companyId } });
    if (!pattern) return NextResponse.json({ error: "Pattern not found" }, { status: 404 });

    // Remove any existing skip or one-time outflow for this pattern/sourceWeek combination
    // (prevents duplicate skips if user clicks twice)
    await prisma.override.updateMany({
        where: {
            companyId,
            targetId: patternId,
            type: "skip_recurring_occurrence",
            effectiveDate: new Date(sourceWeekStart),
            status: "active",
        },
        data: { status: "archived" },
    });

    // Create the two overrides in a transaction
    const [skipOverride, onetimeOverride] = await prisma.$transaction([
        // 1. Skip the occurrence in the source week
        prisma.override.create({
            data: {
                id: uuidv4(),
                companyId,
                type: "skip_recurring_occurrence",
                targetType: "recurring",
                targetId: patternId,
                effectiveDate: new Date(sourceWeekStart),
                metaJson: `recurring:${displayName}`,
                status: "active",
            },
        }),
        // 2. Add a one-time outflow in the target week
        // metaJson encodes "recurring:<displayName>|from:<sourceWeekStart>" so the dashboard can identify these as rescheduled items
        prisma.override.create({
            data: {
                id: uuidv4(),
                companyId,
                type: "add_one_time_outflow",
                targetType: "recurring",
                targetId: patternId,
                amount,
                effectiveDate: new Date(targetWeekStart),
                metaJson: `recurring:${displayName}|from:${sourceWeekStart}`,
                status: "active",
            },
        }),
    ]);

    return NextResponse.json({ skipId: skipOverride.id, onetimeId: onetimeOverride.id, ok: true });
}

/** DELETE /api/recurring-reschedule?skipId=...&onetimeId=...
 *  Undoes a reschedule by archiving both override records. */
export async function DELETE(req: NextRequest) {
    const skipId = req.nextUrl.searchParams.get("skipId");
    const onetimeId = req.nextUrl.searchParams.get("onetimeId");
    const patternId = req.nextUrl.searchParams.get("patternId");
    const sourceWeekStart = req.nextUrl.searchParams.get("sourceWeekStart");

    if (skipId && onetimeId) {
        // Precise undo by override IDs
        await prisma.override.updateMany({
            where: { id: { in: [skipId, onetimeId] } },
            data: { status: "archived" },
        });
    } else if (patternId && sourceWeekStart) {
        // Undo by pattern + source week (used when IDs not available)
        await prisma.override.updateMany({
            where: {
                targetId: patternId,
                effectiveDate: new Date(sourceWeekStart),
                type: { in: ["skip_recurring_occurrence", "add_one_time_outflow"] },
                status: "active",
            },
            data: { status: "archived" },
        });
    } else {
        return NextResponse.json({ error: "Provide skipId+onetimeId or patternId+sourceWeekStart" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
}
