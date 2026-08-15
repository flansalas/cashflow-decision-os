export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";
import { resolveForecastHashAfter } from "@/services/forecast-hash";

export async function GET(req: NextRequest) {
    try {
        const tenantId = await resolveTenant(req);
        if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const url = new URL(req.url);
        const weekStartStr = url.searchParams.get("weekStart");

        let whereClause: any = { companyId: tenantId };
        if (weekStartStr) {
            whereClause.weekStart = new Date(weekStartStr);
        }

        const plans = await prisma.executionPlan.findMany({
            where: whereClause,
            orderBy: [{ weekStart: 'desc' }, { version: 'desc' }],
            include: { actionItems: true }
        });

        return NextResponse.json({ plans });

    } catch (e: any) {
        console.error("Execution Plan GET Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}

import { approveExecutionPlan, ApprovalValidationError, ApprovalConflictError } from "@/services/execution-plan-approval";

export async function POST(req: NextRequest) {
    try {
        const tenantId = await resolveTenant(req);
        if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const authResult = await auth();
        const userId = authResult?.userId || null;

        const body = await req.json();
        const { weekStart, forecastCheckpointId, expectedCurrentPlanId, revisionReason, actions } = body;

        try {
            const plan = await approveExecutionPlan({
                companyId: tenantId,
                approvedBy: userId || undefined,
                weekStart,
                forecastCheckpointId,
                expectedCurrentPlanId,
                revisionReason,
                actions: Array.isArray(actions) ? actions : []
            });
            return NextResponse.json({ success: true, plan });
        } catch (err: any) {
            if (err instanceof ApprovalValidationError) {
                return NextResponse.json({ error: err.message }, { status: 400 });
            }
            if (err instanceof ApprovalConflictError) {
                return NextResponse.json({ error: err.message }, { status: 409 });
            }
            throw err;
        }

    } catch (e: any) {
        console.error("Execution Plan POST Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
