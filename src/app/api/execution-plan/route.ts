import { NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const companyId = url.searchParams.get("companyId");
        const weekStartParam = url.searchParams.get("weekStart");

        if (!companyId || !weekStartParam) {
            return NextResponse.json({ error: "Missing required query parameters" }, { status: 400 });
        }

        const weekStart = new Date(weekStartParam);

        // prefer status = "approved", if no approved plan exists, optionally return "executed"
        const plans = await prisma.executionPlan.findMany({
            where: {
                companyId,
                weekStart,
                status: {
                    in: ["approved", "executed"]
                }
            },
            orderBy: {
                version: 'desc'
            }
        });

        if (plans.length === 0) {
            return NextResponse.json({ plan: null });
        }

        // Prefer "approved" over "executed"
        const approvedPlan = plans.find(p => p.status === "approved");
        const planToReturn = approvedPlan || plans[0];

        return NextResponse.json({ plan: planToReturn });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { companyId, weekStart, weekEnd, planHash, itemsJson, summaryJson } = body;

        if (!companyId || !weekStart || !weekEnd || !planHash || !itemsJson || !summaryJson) {
            return NextResponse.json({ error: "Missing required body parameters" }, { status: 400 });
        }

        const weekStartDate = new Date(weekStart);
        const weekEndDate = new Date(weekEnd);

        const newPlan = await prisma.$transaction(async (tx) => {
            // 1. Find existing approved plan
            const existingApprovedPlan = await tx.executionPlan.findFirst({
                where: {
                    companyId,
                    weekStart: weekStartDate,
                    status: "approved"
                },
                orderBy: {
                    version: 'desc'
                }
            });

            const newVersion = existingApprovedPlan ? existingApprovedPlan.version + 1 : 1;

            // 2. Create the new approved plan
            const plan = await tx.executionPlan.create({
                data: {
                    companyId,
                    weekStart: weekStartDate,
                    weekEnd: weekEndDate,
                    status: "approved",
                    version: newVersion,
                    planHash,
                    itemsJson,
                    summaryJson
                }
            });

            // 3. Supersede the old plan
            if (existingApprovedPlan) {
                await tx.executionPlan.update({
                    where: { id: existingApprovedPlan.id },
                    data: {
                        status: "superseded",
                        supersededAt: new Date(),
                        supersededByPlanId: plan.id
                    }
                });
            }

            return plan;
        });

        return NextResponse.json({ plan: newPlan });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
