import { NextRequest, NextResponse } from "next/server";
import { resolveTenant } from "@/lib/tenant";
import { evaluateCompanyDataReadiness } from "@/services/data-readiness-evaluation";

export async function GET(req: NextRequest) {
    try {
        const companyId = await resolveTenant(req);
        
        if (!companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const requestedCompanyId = req.nextUrl.searchParams.get("companyId");
        if (requestedCompanyId && requestedCompanyId !== companyId) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const readiness = await evaluateCompanyDataReadiness(companyId, new Date());
        
        return NextResponse.json(readiness, { status: 200 });
    } catch (e: any) {
        console.error("Error evaluating data readiness:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
