// POST /api/cash-checkin
// Weekly roll ritual: saves a new CashSnapshot with today's balance.
// Does NOT delete old snapshots — history is preserved.
// The dashboard API uses findFirst(orderBy: asOfDate desc), so the new snapshot
// is automatically picked up and the forecast rolls forward.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

/**
 * Rolls a date forward by the given cadence until it is >= the asOfDate.
 */
function rollDate(startDate: Date, asOfDate: Date, cadence: string): Date {
    const d = new Date(startDate);
    // Safety break to prevent infinite loops (max 5 years forward)
    const maxDate = new Date(asOfDate);
    maxDate.setFullYear(maxDate.getFullYear() + 5);

    while (d < asOfDate && d < maxDate) {
        if (cadence === "weekly") d.setDate(d.getDate() + 7);
        else if (cadence === "biweekly") d.setDate(d.getDate() + 14);
        else if (cadence === "monthly") {
            const currentMonth = d.getMonth();
            d.setMonth(currentMonth + 1);
            // Handle month-end issues (e.g. Jan 31 -> Feb 28)
            if (d.getMonth() === (currentMonth + 2) % 12) {
                d.setDate(0);
            }
        }
        else break;
    }
    return d;
}

export async function POST(req: NextRequest) {
    const body = await req.json() as {
        companyId: string;
        bankBalance: number;
        asOfDate?: string;
        adjustments?: Array<{ type: string; amount: number; note: string | null }>;
    };

    const { companyId, bankBalance, asOfDate, adjustments = [] } = body;

    if (!companyId) {
        return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    }
    if (typeof bankBalance !== "number" || isNaN(bankBalance)) {
        return NextResponse.json({ error: "bankBalance must be a number" }, { status: 400 });
    }

    const snapshotDate = asOfDate ? new Date(asOfDate) : new Date();

    try {
        // Use a transaction to ensure snapshot and adjustments stay in sync
        const result = await prisma.$transaction(async (tx) => {
            const snapshot = await tx.cashSnapshot.create({
                data: { companyId, bankBalance, asOfDate: snapshotDate },
            });

            // For v0.1, we replace all adjustments with the new list provided during the roll ritual
            await tx.cashAdjustment.deleteMany({ where: { companyId } });

            if (adjustments.length > 0) {
                await tx.cashAdjustment.createMany({
                    data: adjustments.map(a => ({
                        companyId,
                        type: a.type,
                        amount: a.amount,
                        note: a.note,
                        effectiveDate: snapshotDate
                    }))
                });
            }

            // ── Roll forward recurring patterns (including payroll) ─────────────
            const patterns = await tx.recurringPattern.findMany({
                where: { companyId }
            });

            for (const p of patterns) {
                if (!p.nextExpectedDate) continue;
                const rolled = rollDate(p.nextExpectedDate, snapshotDate, p.cadence);
                if (rolled.getTime() !== p.nextExpectedDate.getTime()) {
                    await tx.recurringPattern.update({
                        where: { id: p.id },
                        data: { nextExpectedDate: rolled }
                    });
                }
            }

            // ── Roll forward assumed (synthetic) payroll ───────────────────────
            const assumptions = await tx.assumption.findFirst({
                where: { companyId }
            });

            if (assumptions?.payrollNextDate) {
                const rolled = rollDate(assumptions.payrollNextDate, snapshotDate, assumptions.payrollCadence || "biweekly");
                if (rolled.getTime() !== assumptions.payrollNextDate.getTime()) {
                    await tx.assumption.update({
                        where: { id: assumptions.id },
                        data: { payrollNextDate: rolled }
                    });
                }
            }

            // ── Roll forward What-If Scenarios ──────────────────────────────────
            // Scenarios are week-relative (W1-W13). When we roll, W2 becomes W1, etc.
            // 1. Remove scenarios from the week we just completed (Week 1)
            await tx.scenarioItem.deleteMany({
                where: { companyId, weekNumber: { lte: 1 } }
            });

            // 2. Decrement all future scenarios so they stay aligned with the calendar
            await tx.scenarioItem.updateMany({
                where: { companyId, weekNumber: { gt: 1 } },
                data: { weekNumber: { decrement: 1 } }
            });

            return snapshot;
        });

        return NextResponse.json({ ok: true, snapshotId: result.id, asOfDate: result.asOfDate });
    } catch (error) {
        console.error("Cash check-in error:", error);
        return NextResponse.json({ error: "Failed to save balance and adjustments" }, { status: 500 });
    }
}

