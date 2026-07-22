export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");

    if (!companyId) {
        return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    }

    try {
        const adjustments = await prisma.cashAdjustment.findMany({
            where: { companyId, status: "active" }
        });

        return NextResponse.json({ adjustments });
    } catch (error) {
        console.error("Failed to fetch adjustments:", error);
        return NextResponse.json({ error: "Failed to fetch adjustments" }, { status: 500 });
    }
}
