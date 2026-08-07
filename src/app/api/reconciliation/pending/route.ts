import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export async function GET(req: NextRequest) {
    const authResult = await auth();
    if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const pendingLinks = await prisma.reconciliationLink.findMany({
        where: {
            companyId: tenantId,
            deductFrom: null,
            status: "active"
        },
        orderBy: {
            matchedAmount: "desc"
        },
        take: 1
    });

    if (pendingLinks.length === 0) {
        return NextResponse.json({ pendingMatch: null });
    }

    const link = pendingLinks[0];
    let label = "Unknown";
    let type = link.targetType;
    let amount = Number(link.matchedAmount);
    let direction = "inflow";

    if (link.targetType === "receivable_invoice") {
        const inv = await prisma.receivableInvoice.findUnique({ where: { id: link.targetId } });
        label = inv?.customerName || "Customer Invoice";
        direction = "inflow";
    } else if (link.targetType === "payable_bill") {
        const bill = await prisma.payableBill.findUnique({ where: { id: link.targetId } });
        label = bill?.vendorName || "Vendor Bill";
        direction = "outflow";
    }

    return NextResponse.json({
        pendingMatch: {
            linkId: link.id,
            id: link.targetId,
            label,
            type,
            amount,
            direction
        }
    });
}
