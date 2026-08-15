import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

export async function GET(request: Request) {
    const { orgId, userId } = await auth();
    const companyId = orgId || userId;
    if (!companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const weekStartStr = searchParams.get('weekStart');

    if (!weekStartStr) return NextResponse.json({ error: "Missing weekStart" }, { status: 400 });
    const weekStart = new Date(weekStartStr);
    if (isNaN(weekStart.getTime())) return NextResponse.json({ error: "Invalid weekStart" }, { status: 400 });

    const checkpoints = await prisma.forecastCheckpoint.findMany({
        where: {
            companyId,
            sealedAt: { not: null },
            forecastVersionHash: { not: null },
            canonicalPayloadJson: { not: null },
            forecastSchemaVersion: { not: null },
            hashAlgorithm: { not: null },
            generatedAt: { not: null },
        },
        include: {
            forecastWeeks: {
                orderBy: { weekStart: 'asc' }
            }
        },
        orderBy: { sealedAt: 'desc' }
    });

    // Enforce exactly 13 weeks and W1 match
    const valid = checkpoints.filter(cp => {
        if (cp.forecastWeeks.length !== 13) return false;
        if (cp.forecastWeeks[0].weekStart.getTime() !== weekStart.getTime()) return false;
        return true;
    });

    return NextResponse.json({ checkpoints: valid.map(cp => ({ id: cp.id, sealedAt: cp.sealedAt, forecastVersionHash: cp.forecastVersionHash })) });
}
