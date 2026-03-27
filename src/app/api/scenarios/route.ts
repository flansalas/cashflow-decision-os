// app/api/scenarios/route.ts – GET (list) and POST (create) scenario items
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: NextRequest) {
    const companyId = req.nextUrl.searchParams.get("companyId");
    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

    const items = await prisma.scenarioItem.findMany({
        where: { companyId },
        orderBy: [{ weekNumber: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json(items.map(i => ({
        id: i.id,
        label: i.label,
        direction: i.direction as "in" | "out",
        weekNumber: i.weekNumber,
        amount: i.amount,
    })));
}

export async function POST(req: NextRequest) {
    const { companyId, label, direction, weekNumber, amount } = await req.json() as {
        companyId: string;
        label: string;
        direction: "in" | "out";
        weekNumber: number;
        amount: number;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!label?.trim()) return NextResponse.json({ error: "Label is required" }, { status: 400 });
    if (!["in", "out"].includes(direction)) return NextResponse.json({ error: "Invalid direction" }, { status: 400 });
    if (!weekNumber || weekNumber < 1 || weekNumber > 13) return NextResponse.json({ error: "Week must be 1-13" }, { status: 400 });
    if (!amount || amount <= 0) return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });

    const created = await prisma.scenarioItem.create({
        data: { id: uuidv4(), companyId, label: label.trim(), direction, weekNumber, amount },
    });

    return NextResponse.json({
        id: created.id, label: created.label,
        direction: created.direction as "in" | "out",
        weekNumber: created.weekNumber, amount: created.amount,
    });
}
