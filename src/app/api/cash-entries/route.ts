// API: GET /api/cash-entries?companyId=xxx   — List all entries with category info
// API: POST /api/cash-entries                — Create a new entry

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";
import { resolveTenant } from "@/lib/tenant";

export async function GET(req: NextRequest) {
    const companyId = await resolveTenant(req);
    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

    const entries = await prisma.cashFlowEntry.findMany({
        where: { companyId },
        include: { category: true },
        orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
    });

    const mappedEntries = entries.map(e => {
        const today = new Date();
        const monday = new Date();
        const day = today.getDay();
        const diff = (day === 0 ? -6 : 1 - day);
        monday.setDate(today.getDate() + diff);
        monday.setHours(0, 0, 0, 0);

        const target = new Date(e.targetDate);
        target.setHours(0, 0, 0, 0);

        const diffTime = target.getTime() - monday.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
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

    const today = new Date();
    const monday = new Date();
    const day = today.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    monday.setDate(today.getDate() + diff);
    monday.setHours(0, 0, 0, 0);
    
    const targetDate = new Date(monday);
    targetDate.setDate(targetDate.getDate() + (weekNumber - 1) * 7);

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
