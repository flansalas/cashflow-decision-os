import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function GET(req: NextRequest) {
    try {
        const stats = await prisma.bankTransaction.groupBy({
            by: ['companyId'],
            _count: { id: true },
            _min: { txDate: true },
            _max: { txDate: true }
        });
        return NextResponse.json(stats);
    } catch (e: any) {
        return NextResponse.json({ error: e.message });
    }
}
