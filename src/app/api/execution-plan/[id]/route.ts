import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

export async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> }
) {
    const { orgId, userId } = await auth();
    const companyId = orgId || userId;
    if (!companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await context.params;

    const plan = await prisma.executionPlan.findUnique({
        where: { id },
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

    if (!plan || plan.companyId !== companyId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ plan });
}
