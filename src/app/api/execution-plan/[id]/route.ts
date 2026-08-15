export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    try {
        const tenantId = await resolveTenant(req);
        if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const planId = params.id;
        if (!planId) return NextResponse.json({ error: "Missing plan ID" }, { status: 400 });

        const plan = await prisma.executionPlan.findUnique({
            where: { id: planId },
            include: {
                actionItems: true,
                forecastCheckpoint: {
                    include: {
                        forecastWeeks: {
                            orderBy: { weekStart: 'asc' }
                        }
                    }
                }
            }
        });

        if (!plan || plan.companyId !== tenantId) {
            return NextResponse.json({ error: "Plan not found" }, { status: 404 });
        }

        return NextResponse.json({ plan });

    } catch (e: any) {
        console.error("Execution Plan Detail GET Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
