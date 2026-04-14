import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export async function GET(req: NextRequest) {
    try {
        const tenantId = await resolveTenant(req);
        if (!tenantId) {
            return NextResponse.json({ error: "Company not found" }, { status: 404 });
        }

        const logs = await prisma.changeLog.findMany({
            where: { companyId: tenantId },
            orderBy: { timestamp: "desc" },
            take: 100,
        });

        return NextResponse.json(logs);
    } catch (error) {
        console.error("Audit API error:", error);
        return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: 500 });
    }
}
