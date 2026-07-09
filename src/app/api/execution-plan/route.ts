import { NextResponse } from "next/server";
import { getAuth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

export async function GET(req: Request) {
    try {
        const { orgId } = getAuth(req as any);
        if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const company = await prisma.company.findUnique({
            where: { clerkOrgId: orgId },
        });

        if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

        const url = new URL(req.url);
        const weekStartStr = url.searchParams.get("weekStart");

        let whereClause: any = { companyId: company.id };
        if (weekStartStr) {
            whereClause.weekStart = new Date(weekStartStr);
        }

        const plans = await prisma.executionPlan.findMany({
            where: whereClause,
            orderBy: [{ weekStart: 'desc' }, { version: 'desc' }]
        });

        return NextResponse.json({ plans });

    } catch (e: any) {
        console.error("Execution Plan GET Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const { orgId, userId } = getAuth(req as any);
        if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const company = await prisma.company.findUnique({
            where: { clerkOrgId: orgId },
        });

        if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

        const body = await req.json();
        const { weekStart, forecastStateJson, revisionReason } = body;

        if (!weekStart) {
            return NextResponse.json({ error: "Missing weekStart" }, { status: 400 });
        }

        const dateWeekStart = new Date(weekStart);

        const result = await prisma.$transaction(async (tx) => {
            const existing = await tx.executionPlan.findFirst({
                where: {
                    companyId: company.id,
                    weekStart: dateWeekStart,
                    status: "approved"
                },
                orderBy: { version: "desc" }
            });

            let newVersion = 1;

            if (existing) {
                newVersion = existing.version + 1;
            }

            const newPlan = await tx.executionPlan.create({
                data: {
                    companyId: company.id,
                    weekStart: dateWeekStart,
                    version: newVersion,
                    status: "approved",
                    approvedBy: userId,
                    revisionReason: revisionReason || null,
                    forecastStateJson: forecastStateJson ? JSON.stringify(forecastStateJson) : null
                }
            });

            if (existing) {
                await tx.executionPlan.update({
                    where: { id: existing.id },
                    data: {
                        status: "superseded",
                        supersededAt: new Date(),
                        supersededByPlanId: newPlan.id
                    }
                });

                await tx.changeLog.create({
                    data: {
                        companyId: company.id,
                        source: "user_ui",
                        action: "PLAN_REVISION",
                        inputText: revisionReason,
                        diffJson: JSON.stringify({ version: newVersion, previousVersion: existing.version }),
                        forecastVersionHashAfter: "pending"
                    }
                });
            }

            return newPlan;
        });

        return NextResponse.json({ success: true, plan: result });

    } catch (e: any) {
        console.error("Execution Plan POST Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
