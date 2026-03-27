// API: GET /api/cash-entries?companyId=xxx   — List all entries with category info
// API: POST /api/cash-entries                — Create a new entry

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: NextRequest) {
    const companyId = req.nextUrl.searchParams.get("companyId");
    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

    const entries = await prisma.cashFlowEntry.findMany({
        where: { companyId },
        include: { category: true },
        orderBy: [{ weekNumber: "asc" }, { createdAt: "asc" }],
    });
    return NextResponse.json(entries);
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

    try {
        const created = await prisma.cashFlowEntry.create({
            data: {
                id: uuidv4(),
                companyId,
                categoryId,
                label: label.trim(),
                amount,
                weekNumber,
                note: note?.trim() || null,
            },
            include: { category: true },
        });
        return NextResponse.json(created);
    } catch (error) {
        console.error("Create entry error:", error);
        return NextResponse.json({ error: "Failed to create entry" }, { status: 500 });
    }
}
