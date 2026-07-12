import { NextResponse } from "next/server";
import { getAuth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveForecastHashAfter } from "@/services/forecast-hash";

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
            orderBy: [{ weekStart: 'desc' }, { version: 'desc' }],
            include: { actionItems: true }
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
        const { weekStart, forecastStateJson, revisionReason, actions } = body;

        if (!weekStart) {
            return NextResponse.json({ error: "Missing weekStart" }, { status: 400 });
        }

        const validActions = Array.isArray(actions) ? actions : [];
        for (const a of validActions) {
            if (!a.ownerName || !a.dueDate || a.amountImpact == null || !a.constraintWeekStart || !a.type || !a.title || !a.description || !a.targetType || !a.reasoningJson) {
                return NextResponse.json({ error: "Invalid action payload. Missing required fields." }, { status: 400 });
            }
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
                    forecastStateJson: forecastStateJson ? JSON.stringify(forecastStateJson) : null,
                    actionItems: {
                        create: validActions.map(a => ({
                            companyId: company.id,
                            ownerName: a.ownerName,
                            dueDate: new Date(a.dueDate),
                            amountImpact: a.amountImpact,
                            constraintWeekStart: new Date(a.constraintWeekStart),
                            type: a.type,
                            title: a.title,
                            description: a.description,
                            targetType: a.targetType,
                            targetId: a.targetId || null,
                            reasoningJson: typeof a.reasoningJson === "string" ? a.reasoningJson : JSON.stringify(a.reasoningJson),
                            priority: a.priority || "p2",
                            impactCertainty: a.impactCertainty || "med",
                            status: "planned"
                        }))
                    }
                }
            });

            let changeLogId = null;

            if (existing) {
                await tx.executionPlan.update({
                    where: { id: existing.id },
                    data: {
                        status: "superseded",
                        supersededAt: new Date(),
                        supersededByPlanId: newPlan.id
                    }
                });

                const cl = await tx.changeLog.create({
                    data: {
                        companyId: company.id,
                        source: "user_ui",
                        action: "PLAN_REVISION",
                        inputText: revisionReason,
                        diffJson: JSON.stringify({ version: newVersion, previousVersion: existing.version }),
                        forecastVersionHashAfter: "pending",
                        userId: userId
                    }
                });
                changeLogId = cl.id;
            } else {
                const cl = await tx.changeLog.create({
                    data: {
                        companyId: company.id,
                        source: "user_ui",
                        action: "INITIAL_PLAN_APPROVAL",
                        inputText: "Approved initial weekly execution plan",
                        diffJson: JSON.stringify({ planId: newPlan.id, version: newVersion }),
                        forecastVersionHashAfter: "pending",
                        userId: userId
                    }
                });
                changeLogId = cl.id;
            }

            return { newPlan, changeLogId };
        });

        if (result.changeLogId) {
            await resolveForecastHashAfter(company.id, result.changeLogId);
        }

        return NextResponse.json({ success: true, plan: result.newPlan });

    } catch (e: any) {
        console.error("Execution Plan POST Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
