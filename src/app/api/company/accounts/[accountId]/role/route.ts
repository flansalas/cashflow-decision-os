import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ accountId: string }> }
) {
    const { userId } = getAuth(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { accountId } = await context.params;
    if (!accountId) return NextResponse.json({ error: "Missing accountId" }, { status: 400 });

    try {
        const body = await req.json();
        const { role } = body;
        if (!role || !["operating", "payroll"].includes(role)) {
            return NextResponse.json({ error: "Invalid role" }, { status: 400 });
        }

        const account = await prisma.bankAccount.update({
            where: { id: accountId },
            data: { role },
        });
        
        return NextResponse.json({ account });
    } catch (error) {
        console.error("Failed to update bank account role:", error);
        return NextResponse.json({ error: "Failed to update role" }, { status: 500 });
    }
}
