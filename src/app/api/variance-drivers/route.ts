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
import { getDeterministicVarianceDrivers } from "@/services/deterministic-variance";

export async function GET(req: NextRequest) {
    try {
        // ── Tenant resolution ──────────────────────────────────────────────────
        const companyId = await resolveTenant(req);
        if (!companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = req.nextUrl;
        
        const requestedCompanyId = searchParams.get("companyId");
        if (requestedCompanyId && requestedCompanyId !== companyId) {
            return NextResponse.json({ error: "Forbidden: cross-tenant access denied" }, { status: 403 });
        }

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

        const deterministicResult = await getDeterministicVarianceDrivers(targetCheckpointId, companyId);
        
        if (deterministicResult) {
            return NextResponse.json(deterministicResult);
        }

        // Fallback to legacy
        const legacyResult = await computeVarianceDrivers(targetCheckpointId, companyId);
        return NextResponse.json({ ...legacyResult, isDeterministic: false });
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
