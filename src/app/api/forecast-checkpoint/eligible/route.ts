import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";
import {
    computeCanonicalHash,
    FORECAST_SCHEMA_VERSION,
    HASH_ALGORITHM
} from "@/services/canonical-hash";

export async function GET(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const companyId = await resolveTenant(request);
    if (!companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const requestedCompanyId = request.nextUrl.searchParams.get("companyId");
    if (requestedCompanyId && requestedCompanyId !== companyId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const weekStartValue = request.nextUrl.searchParams.get("weekStart");
    const requestedWeekStart = weekStartValue ? new Date(weekStartValue) : null;
    if (requestedWeekStart && Number.isNaN(requestedWeekStart.getTime())) {
        return NextResponse.json({ error: "Invalid weekStart" }, { status: 400 });
    }

    const checkpoints = await prisma.forecastCheckpoint.findMany({
        where: {
            companyId,
            sealedAt: { not: null },
            forecastVersionHash: { not: null },
            canonicalPayloadJson: { not: null },
            forecastSchemaVersion: FORECAST_SCHEMA_VERSION,
            hashAlgorithm: HASH_ALGORITHM,
            generatedAt: { not: null }
        },
        include: {
            cashSnapshot: { select: { asOfDate: true, companyId: true } },
            forecastWeeks: { orderBy: { weekStart: "asc" } }
        },
        orderBy: [{ sealedAt: "desc" }, { id: "desc" }]
    });

    const valid = checkpoints.filter(checkpoint => {
        if (checkpoint.cashSnapshot.companyId !== companyId) return false;
        try {
            JSON.parse(checkpoint.canonicalPayloadJson!);
        } catch {
            return false;
        }
        if (computeCanonicalHash(checkpoint.canonicalPayloadJson!) !== checkpoint.forecastVersionHash) return false;
        const weeks = checkpoint.forecastWeeks;
        if (weeks.length !== 13) return false;
        if (weeks[0].weekStart.getTime() !== checkpoint.weekStart.getTime()) return false;
        if (requestedWeekStart && weeks[0].weekStart.getTime() !== requestedWeekStart.getTime()) return false;
        for (let index = 1; index < weeks.length; index += 1) {
            if (weeks[index].weekStart.getTime() - weeks[index - 1].weekStart.getTime() !== 7 * 24 * 60 * 60 * 1000) {
                return false;
            }
        }
        return true;
    });

    return NextResponse.json({
        checkpoints: valid.map((checkpoint, index) => ({
            id: checkpoint.id,
            weekStart: checkpoint.weekStart,
            weekEnd: checkpoint.forecastWeeks[12].weekEnd,
            generatedAt: checkpoint.generatedAt,
            sealedAt: checkpoint.sealedAt,
            cashAsOfDate: checkpoint.cashSnapshot.asOfDate,
            forecastVersionHash: checkpoint.forecastVersionHash,
            isCurrent: index === 0
        }))
    });
}
