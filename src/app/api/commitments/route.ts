// API: POST /api/commitments
// Creates a new RecurringPattern (outflow commitment) from the dashboard.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
    const { companyId, displayName, category, cadence, typicalAmount, nextExpectedDate, isCritical, direction } =
        await req.json() as {
            companyId: string;
            displayName: string;
            category: string;
            cadence: string;
            typicalAmount: number;
            nextExpectedDate: string;
            isCritical?: boolean;
            direction?: string;
        };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!displayName?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (!typicalAmount || typicalAmount <= 0) return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
    if (!nextExpectedDate) return NextResponse.json({ error: "Next date is required" }, { status: 400 });

    try {
        const created = await prisma.recurringPattern.create({
            data: {
                id: uuidv4(),
                companyId,
                direction: direction || "outflow",
                merchantKey: displayName.trim().toLowerCase().replace(/\s+/g, "_"),
                displayName: displayName.trim(),
                typicalAmount,
                amountStdDev: 0,
                cadence: cadence ?? "monthly",
                nextExpectedDate: new Date(nextExpectedDate),
                confidence: "med",
                category: category ?? "other",
                isIncluded: true,
                isCritical: isCritical ?? false,
            },
        });

        return NextResponse.json({
            id: created.id,
            displayName: created.displayName,
            category: created.category,
            cadence: created.cadence,
            nextExpectedDate: created.nextExpectedDate,
            typicalAmount: created.typicalAmount,
            amountStdDev: created.amountStdDev,
            confidence: created.confidence,
            isIncluded: created.isIncluded,
            isCritical: created.isCritical,
            direction: created.direction,
        });
    } catch (error) {
        console.error("Create commitment error:", error);
        return NextResponse.json({ error: "Failed to create commitment" }, { status: 500 });
    }
}
