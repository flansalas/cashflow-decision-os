import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { companyId, bufferMin, projectionSafetyMargin } = body;

        if (!companyId) {
            return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
        }

        const dataToUpdate: any = {};
        if (bufferMin !== undefined) dataToUpdate.bufferMin = bufferMin;
        if (projectionSafetyMargin !== undefined) dataToUpdate.projectionSafetyMargin = projectionSafetyMargin;

        const existing = await prisma.assumption.findFirst({ where: { companyId } });
        let updated;
        if (existing) {
            updated = await prisma.assumption.update({
                where: { id: existing.id },
                data: dataToUpdate,
            });
        } else {
            updated = await prisma.assumption.create({
                data: { companyId, ...dataToUpdate },
            });
        }

        // Also trigger a re-run of the forecast by ensuring cash snapshot timestamp is updated
        // Actually, we don't strictly need to do this, Dashboard re-fetches and re-computes on the fly.
        // But if there are saved actions/scenarios we might just need to reload.

        return NextResponse.json({ success: true, assumption: updated });
    } catch (e: any) {
        console.error("API error updating assumptions:", e);
        return NextResponse.json({ error: "Failed to update assumptions" }, { status: 500 });
    }
}
