export const dynamic = 'force-dynamic';
// app/api/variance-drivers/route.ts
// GET /api/variance-drivers?checkpointId=<uuid>
// GET /api/variance-drivers?latest=true
//
// Uses resolveTenant() — checkpoint is double-guarded (id + companyId).

import { NextRequest, NextResponse } from "next/server";
import { resolveTenant } from "@/lib/tenant";
import prisma from "@/db/prisma";
import { computeVarianceDrivers } from "@/services/variance-drivers";

export async function GET(req: NextRequest) {
    try {
        // ── Tenant resolution ──────────────────────────────────────────────────
        const companyId = await resolveTenant(req);
        if (!companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = req.nextUrl;
        const checkpointIdParam = searchParams.get("checkpointId");
        const latestParam = searchParams.get("latest");

        let targetCheckpointId: string;

        if (checkpointIdParam) {
            // Direct lookup — tenant guard is enforced inside computeVarianceDrivers
            targetCheckpointId = checkpointIdParam;
        } else if (latestParam === "true") {
            // Find the most recent checkpoint for this tenant
            const latest = await prisma.forecastCheckpoint.findFirst({
                where: { companyId },
                orderBy: { createdAt: "desc" },
                select: { id: true },
            });
            if (!latest) {
                return NextResponse.json({ error: "No checkpoint found" }, { status: 404 });
            }
            targetCheckpointId = latest.id;
        } else {
            return NextResponse.json(
                { error: "Provide ?checkpointId=<uuid> or ?latest=true" },
                { status: 400 }
            );
        }

        const result = await computeVarianceDrivers(targetCheckpointId, companyId);
        return NextResponse.json(result);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Unknown error";
        // Not-found errors from the service become 404
        if (message.includes("not found")) {
            return NextResponse.json({ error: message }, { status: 404 });
        }
        console.error("[variance-drivers] Error:", err);
        return NextResponse.json({ error: "Failed to compute variance drivers" }, { status: 500 });
    }
}
