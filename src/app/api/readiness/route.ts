import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { evaluateCompanyDataReadiness } from "@/services/data-readiness-evaluation";

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const companyId = searchParams.get('companyId');
        
        if (!companyId) {
            return NextResponse.json({ error: "Missing companyId parameter" }, { status: 400 });
        }

        const company = await prisma.company.findUnique({
            where: { id: companyId }
        });

        if (!company) {
            return NextResponse.json({ error: "Company not found" }, { status: 404 });
        }

        const readiness = await evaluateCompanyDataReadiness(companyId, new Date());
        
        return NextResponse.json(readiness, { status: 200 });
    } catch (e: any) {
        console.error("Error evaluating data readiness:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
