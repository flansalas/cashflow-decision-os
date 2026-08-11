import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";
import { waitUntil } from "@vercel/functions";
import { buildAndCacheBaseline } from "@/services/baseline-snapshot";

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ accountId: string }> }
) {
    const { userId } = getAuth(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Tenant resolution failed" }, { status: 403 });

    const { accountId } = await context.params;
    if (!accountId) return NextResponse.json({ error: "Missing accountId" }, { status: 400 });

    try {
        const body = await req.json();
        const { role } = body;
        if (!role || !["operating", "payroll"].includes(role)) {
            return NextResponse.json({ error: "Invalid role" }, { status: 400 });
        }

        // Verify account belongs to tenant
        const account = await prisma.bankAccount.findFirst({
            where: { id: accountId, companyId: tenantId }
        });
        if (!account) return NextResponse.json({ error: "Account not found or access denied" }, { status: 404 });

        const updatedAccount = await prisma.bankAccount.update({
            where: { id: accountId },
            data: { role },
        });

        // Invalidate cached baseline
        await prisma.baselineSnapshot.deleteMany({
            where: { companyId: tenantId }
        });
        
        // Rebuild baseline caching
        waitUntil(buildAndCacheBaseline(tenantId));

        return NextResponse.json({ account: updatedAccount });
    } catch (error) {
        console.error("Failed to update bank account role:", error);
        return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
    }
}
