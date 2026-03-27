// POST /api/onboarding/cash
// Step 1: Save CashSnapshot + CashAdjustments, advance onboardingStep to 1.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

interface AdjustmentInput {
    amount: number;
    note?: string;
}

export async function POST(req: NextRequest) {
    const { companyId, bankBalance, asOfDate, adjustments } = await req.json() as {
        companyId: string;
        bankBalance: number;
        asOfDate: string;
        adjustments: AdjustmentInput[];
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (typeof bankBalance !== "number" || isNaN(bankBalance)) {
        return NextResponse.json({ error: "Bank balance is required" }, { status: 400 });
    }

    const snapshotDate = asOfDate ? new Date(asOfDate) : new Date();

    try {
        // Delete old snapshots + adjustments for a clean slate
        await prisma.cashAdjustment.deleteMany({ where: { companyId } });
        await prisma.cashSnapshot.deleteMany({ where: { companyId } });

        // Create new snapshot
        await prisma.cashSnapshot.create({
            data: { companyId, bankBalance, asOfDate: snapshotDate },
        });

        // Create adjustments
        const validAdjustments = (adjustments ?? []).filter(
            a => typeof a.amount === "number" && !isNaN(a.amount) && a.amount !== 0
        );

        if (validAdjustments.length > 0) {
            await prisma.cashAdjustment.createMany({
                data: validAdjustments.map(a => ({
                    companyId,
                    type: "other",
                    amount: a.amount,
                    note: a.note ?? null,
                    effectiveDate: snapshotDate,
                })),
            });
        }

        // Advance onboarding step
        await prisma.company.update({
            where: { id: companyId },
            data: { onboardingStep: 1 },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Onboarding cash error:", error);
        return NextResponse.json({ error: "Failed to save cash snapshot" }, { status: 500 });
    }
}
