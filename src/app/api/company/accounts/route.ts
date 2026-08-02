import { NextRequest, NextResponse } from "next/server";
import { getAuth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

export async function GET(req: NextRequest) {
    const { userId } = getAuth(req);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const searchParams = req.nextUrl.searchParams;
    const companyId = searchParams.get("companyId");
    
    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

    try {
        const accounts = await prisma.bankAccount.findMany({
            where: { companyId },
            orderBy: { name: 'asc' }
        });
        
        return NextResponse.json({ accounts });
    } catch (error) {
        console.error("Failed to fetch bank accounts:", error);
        return NextResponse.json({ error: "Failed to fetch bank accounts" }, { status: 500 });
    }
}
