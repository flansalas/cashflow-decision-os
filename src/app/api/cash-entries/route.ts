// API: GET /api/cash-entries?companyId=xxx   — List all entries with category info
// API: POST /api/cash-entries                — Create a new entry

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";
import { resolveTenant } from "@/lib/tenant";

/** Mirrors forecast.ts getMonday — returns UTC-midnight Monday for a given date. */
function getMondayUTC(d: Date): Date {
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1 - day);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}

export async function GET(req: NextRequest) {
    const companyId = await resolveTenant(req);
    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

    const [entries, snapshot] = await Promise.all([
        prisma.cashFlowEntry.findMany({
            where: { companyId },
            include: { category: true },
            orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
        }),
        prisma.cashSnapshot.findFirst({ where: { companyId }, orderBy: { asOfDate: "desc" } }),
    ]);

    // Use the same Monday the forecast uses: getMonday(cashSnapshot.asOfDate)
    const baseMonday = snapshot ? getMondayUTC(new Date(snapshot.asOfDate)) : getMondayUTC(new Date());

    const mappedEntries = entries.map(e => {
        const targetMidnightUTC = new Date(Date.UTC(
            new Date(e.targetDate).getUTCFullYear(),
            new Date(e.targetDate).getUTCMonth(),
            new Date(e.targetDate).getUTCDate()
        ));
        const diffDays = Math.round((targetMidnightUTC.getTime() - baseMonday.getTime()) / (1000 * 60 * 60 * 24));
        let weekNumber = Math.floor(diffDays / 7) + 1;
        if (weekNumber < 1) weekNumber = 1;
        return { ...e, weekNumber };
    });

    return NextResponse.json(mappedEntries);
}

export async function POST(req: NextRequest) {
    const { companyId, categoryId, label, amount, weekNumber, note } = await req.json() as {
        companyId: string; categoryId: string; label: string; amount: number; weekNumber: number; note?: string;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!categoryId) return NextResponse.json({ error: "Missing categoryId" }, { status: 400 });
    if (!label?.trim()) return NextResponse.json({ error: "Label is required" }, { status: 400 });
    if (!amount || amount <= 0) return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
    if (!weekNumber || weekNumber < 1 || weekNumber > 13) return NextResponse.json({ error: "Week number must be 1-13" }, { status: 400 });

    // Use the same Monday the forecast uses: getMonday(cashSnapshot.asOfDate)
    const snapshot = await prisma.cashSnapshot.findFirst({ where: { companyId }, orderBy: { asOfDate: "desc" } });
    const baseMonday = snapshot ? getMondayUTC(new Date(snapshot.asOfDate)) : getMondayUTC(new Date());
    const targetDate = new Date(baseMonday.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000);

    try {
        const created = await prisma.cashFlowEntry.create({
            data: {
                id: uuidv4(),
                companyId,
                categoryId,
                label: label.trim(),
                amount,
                targetDate,
                note: note?.trim() || null,
            },
            include: { category: true },
        });
        return NextResponse.json({ ...created, weekNumber });
    } catch (error) {
        console.error("Create entry error:", error);
        return NextResponse.json({ error: "Failed to create entry" }, { status: 500 });
    }
}
