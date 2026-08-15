export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export async function GET(req: NextRequest) {
    try {
        const tenantId = await resolveTenant(req);
        if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const url = new URL(req.url);
        const weekStartStr = url.searchParams.get("weekStart");
        if (!weekStartStr) {
            return NextResponse.json({ error: "Missing weekStart" }, { status: 400 });
        }

        const dateWeekStart = new Date(weekStartStr);

        // Fetch eligible sealed checkpoints
        const checkpoints = await prisma.forecastCheckpoint.findMany({
            where: {
                companyId: tenantId,
                weekStart: dateWeekStart,
                sealedAt: { not: null },
                forecastVersionHash: { not: null },
                canonicalPayloadJson: { not: null }
            },
            orderBy: { sealedAt: 'desc' },
            select: {
                id: true,
                forecastVersionHash: true,
                sealedAt: true,
                forecastSchemaVersion: true,
                hashAlgorithm: true,
                generatedAt: true,
                snapshotSource: true
            }
        });

        return NextResponse.json({ checkpoints });

    } catch (e: any) {
        console.error("Eligible Checkpoints GET Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
