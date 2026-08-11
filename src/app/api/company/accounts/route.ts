import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export async function GET(req: NextRequest) {
    const { userId } = getAuth(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Tenant resolution failed" }, { status: 403 });

    try {
        const accounts = await prisma.bankAccount.findMany({
            where: { companyId: tenantId },
            orderBy: { name: 'asc' }
        });
        
        return NextResponse.json({ accounts });
    } catch (error) {
        console.error("Failed to fetch bank accounts:", error);
        return NextResponse.json({ error: "Failed to fetch bank accounts" }, { status: 500 });
    }
}
