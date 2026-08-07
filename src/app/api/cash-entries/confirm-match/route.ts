import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export async function POST(req: NextRequest) {
    const authResult = await auth();
    if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    // CORRECTION 2: Derive companyId ONLY from the authenticated Clerk organization
    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { linkId, useTimingFrom } = await req.json() as {
        linkId: string;
        useTimingFrom: "source" | "target";
    };

    if (!linkId) return NextResponse.json({ error: "Missing linkId" }, { status: 400 });
    if (useTimingFrom !== "source" && useTimingFrom !== "target") {
        return NextResponse.json({ error: "Invalid useTimingFrom" }, { status: 400 });
    }

    const link = await prisma.reconciliationLink.findUnique({
        where: { id: linkId }
    });

    if (!link || link.companyId !== tenantId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // CORRECTION 1: 
    // Use manual timing (source) -> manual record remains -> deductFrom = "target"
    // Use accounting timing (target) -> accounting record remains -> deductFrom = "source"
    const deductFrom = useTimingFrom === "source" ? "target" : "source";

    const updatedLink = await prisma.reconciliationLink.update({
        where: { id: linkId },
        data: { deductFrom }
    });

    return NextResponse.json({ link: updatedLink });
}
