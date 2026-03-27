// POST /api/onboarding/cash-adjustment
// Appends a single CashAdjustment without wiping existing ones.
// Used by the Reality Check step to add a correction without duplicating Step 1 adjustments.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
    const { companyId, amount, note } = await req.json() as {
        companyId: string;
        amount: number;
        note?: string;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (typeof amount !== "number" || isNaN(amount) || amount === 0) {
        return NextResponse.json({ error: "Non-zero amount is required" }, { status: 400 });
    }

    try {
        // Get the most recent cash snapshot date to anchor the adjustment
        const snapshot = await prisma.cashSnapshot.findFirst({
            where: { companyId },
            orderBy: { asOfDate: "desc" },
        });

        await prisma.cashAdjustment.create({
            data: {
                id: uuidv4(),
                companyId,
                type: "other",
                amount,
                note: note ?? "Reality check adjustment",
                effectiveDate: snapshot?.asOfDate ?? new Date(),
            },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Cash adjustment error:", error);
        return NextResponse.json({ error: "Failed to save adjustment" }, { status: 500 });
    }
}
