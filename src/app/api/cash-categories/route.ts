// API: GET /api/cash-categories?companyId=xxx  — List all categories
// API: POST /api/cash-categories                — Create a new category

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: NextRequest) {
    const companyId = req.nextUrl.searchParams.get("companyId");
    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

    const categories = await prisma.cashFlowCategory.findMany({
        where: { companyId },
        include: { entries: true },
        orderBy: [{ direction: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(categories);
}

export async function POST(req: NextRequest) {
    const { companyId, name, direction, sortOrder } = await req.json() as {
        companyId: string; name: string; direction: string; sortOrder?: number;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (!["inflow", "outflow"].includes(direction)) return NextResponse.json({ error: "Direction must be 'inflow' or 'outflow'" }, { status: 400 });

    try {
        const created = await prisma.cashFlowCategory.create({
            data: {
                id: uuidv4(),
                companyId,
                name: name.trim(),
                direction,
                sortOrder: sortOrder ?? 0,
            },
        });
        return NextResponse.json(created);
    } catch (error: any) {
        if (error?.code === "P2002") {
            return NextResponse.json({ error: "A category with this name and direction already exists" }, { status: 409 });
        }
        console.error("Create category error:", error);
        return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
    }
}
