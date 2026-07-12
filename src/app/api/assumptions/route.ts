import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import prisma from "@/db/prisma";
import { resolveForecastHashAfter } from "@/services/forecast-hash";

export async function POST(req: NextRequest) {
    try {
        const authResult = await auth();
        if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        const tenantId = await resolveTenant(req);
        if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        const { companyId, bufferMin, projectionSafetyMargin } = body;

        if (companyId && companyId !== tenantId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

        const dataToUpdate: any = {};
        if (bufferMin !== undefined) dataToUpdate.bufferMin = bufferMin;
        if (projectionSafetyMargin !== undefined) dataToUpdate.projectionSafetyMargin = projectionSafetyMargin;

        const existing = await prisma.assumption.findFirst({ where: { companyId: tenantId } });
        let updated;
        if (existing) {
            updated = await prisma.assumption.update({
                where: { id: existing.id },
                data: dataToUpdate,
            });
        } else {
            updated = await prisma.assumption.create({
                data: { companyId: tenantId, ...dataToUpdate },
            });
        }

        const cl = await prisma.changeLog.create({
            data: {
                companyId: tenantId,
                action: "UPDATE_ASSUMPTIONS",
                source: "user_ui",
                inputText: `Updated financial assumptions and baseline targets`,
                diffJson: JSON.stringify(dataToUpdate),
                forecastVersionHashAfter: "pending",
            }
        });


        // Also trigger a re-run of the forecast by ensuring cash snapshot timestamp is updated
        // Actually, we don't strictly need to do this, Dashboard re-fetches and re-computes on the fly.
        // But if there are saved actions/scenarios we might just need to reload.

        await resolveForecastHashAfter(tenantId, cl.id);

        return NextResponse.json({ success: true, assumption: updated });
    } catch (e: any) {
        console.error("API error updating assumptions:", e);
        return NextResponse.json({ error: "Failed to update assumptions" }, { status: 500 });
    }
}
