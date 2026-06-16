import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export async function GET(req: NextRequest) {
    try {
        const tenantId = await resolveTenant(req);
        if (!tenantId) {
            return NextResponse.json({ error: "Company not found" }, { status: 404 });
        }

        const targetId = req.nextUrl.searchParams.get("targetId");

        const whereClause: any = { companyId: tenantId };
        if (targetId) {
            // Because diffJson is stored as a string, we can do a contains search for the targetId
            whereClause.diffJson = { contains: `"targetId":"${targetId}"` };
        }

        const logs = await prisma.changeLog.findMany({
            where: whereClause,
            orderBy: { timestamp: "desc" },
            take: 100,
        });

        const events = logs.map(log => {
            let diff: any = {};
            try {
                if (log.diffJson) diff = JSON.parse(log.diffJson);
            } catch (e) { /* ignore */ }

            return {
                id: log.id,
                timestamp: log.timestamp,
                action: log.action,
                source: log.source,
                targetId: diff.targetId || "unknown",
                targetType: diff.targetType || "unknown",
                fieldChanged: diff.fieldChanged || "unknown",
                oldValue: diff.oldValue ?? null,
                newValue: diff.newValue ?? null,
                reasoning: diff.reasoning ?? null,
            };
        });

        return NextResponse.json({ events });
    } catch (error) {
        console.error("Audit API error:", error);
        return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: 500 });
    }
}
