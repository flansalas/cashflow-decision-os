import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function GET(req: NextRequest) {
    const companyId = req.nextUrl.searchParams.get("companyId");

    try {
        let company;
        if (companyId) {
            company = await prisma.company.findUnique({ where: { id: companyId } });
        } else {
            company = await prisma.company.findFirst({ where: { isDemo: true } });
        }

        if (!company) {
            return NextResponse.json({ error: "Company not found" }, { status: 404 });
        }

        const logs = await prisma.changeLog.findMany({
            where: { companyId: company.id },
            orderBy: { timestamp: "desc" },
            take: 100, // Limit to recent 100 for performance
        });

        return NextResponse.json(logs);
    } catch (error) {
        console.error("Audit API error:", error);
        return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: 500 });
    }
}
