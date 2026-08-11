import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";
import { resolveTenant } from "@/lib/tenant";
import { proposeReconciliations } from "@/services/ai-reconciliation";
import { waitUntil } from "@vercel/functions";
import { getManagerialVisibility } from "@/services/managerial-visibility";

function getMondayUTC(d: Date): Date {
    const day = d.getUTCDay();
    const diff = (day === 0 ? -6 : 1 - day);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
}

export async function POST(req: NextRequest) {
    const authResult = await auth();
    if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    
    // CORRECTION 2: Derive companyId ONLY from the authenticated Clerk organization
    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { amount, weekNumber, label, direction } = await req.json() as {
        amount: number;
        weekNumber: number;
        label: string;
        direction: "inflow" | "outflow";
    };

    if (!label?.trim()) return NextResponse.json({ error: "Label is required" }, { status: 400 });
    if (!amount || amount <= 0) return NextResponse.json({ error: "Amount must be positive" }, { status: 400 });
    if (!weekNumber || weekNumber < 1 || weekNumber > 13) return NextResponse.json({ error: "Week number must be 1-13" }, { status: 400 });
    if (direction !== "inflow" && direction !== "outflow") return NextResponse.json({ error: "Invalid direction" }, { status: 400 });

    const snapshot = await prisma.cashSnapshot.findFirst({ 
        where: { companyId: tenantId }, 
        orderBy: [{ asOfDate: "desc" }, { createdAt: "desc" }] 
    });
    const baseMonday = snapshot ? getMondayUTC(new Date(snapshot.asOfDate)) : getMondayUTC(new Date());
    const targetDate = new Date(baseMonday.getTime() + (weekNumber - 1) * 7 * 24 * 60 * 60 * 1000);

    let category = await prisma.cashFlowCategory.findFirst({
        where: { companyId: tenantId, direction }
    });

    if (!category) {
        category = await prisma.cashFlowCategory.create({
            data: {
                id: uuidv4(),
                companyId: tenantId,
                name: direction === "inflow" ? "Uncategorized Inflow" : "Uncategorized Outflow",
                direction
            }
        });
    }

    // Create the entry
    const entryId = uuidv4();
    const createdEntry = await prisma.cashFlowEntry.create({
        data: {
            id: entryId,
            companyId: tenantId,
            categoryId: category.id,
            label: label.trim(),
            amount,
            targetDate
        }
    });

    // Check for pending matches (Exact dollar matching only, same direction, active AR/AP)
    let pendingMatch = null;
    let pendingLinkId = null;
    const visibility = await getManagerialVisibility(tenantId);

    if (direction === "inflow") {
        const potentialInvoice = await prisma.receivableInvoice.findFirst({
            where: { companyId: tenantId, amountOpen: amount, status: "open", id: { notIn: [...visibility.hiddenInvoiceIds] } }
        });
        if (potentialInvoice) {
            pendingMatch = {
                id: potentialInvoice.id,
                label: potentialInvoice.customerName || "Customer Invoice",
                type: "receivable_invoice",
                expectedDate: potentialInvoice.dueDate
            };
        }
    } else {
        const potentialBill = await prisma.payableBill.findFirst({
            where: { companyId: tenantId, amountOpen: amount, status: "open", id: { notIn: [...visibility.hiddenBillIds] } }
        });
        if (potentialBill) {
            pendingMatch = {
                id: potentialBill.id,
                label: potentialBill.vendorName || "Vendor Bill",
                type: "payable_bill",
                expectedDate: potentialBill.dueDate
            };
        }
    }

    if (pendingMatch) {
        pendingLinkId = uuidv4();
        await prisma.reconciliationLink.create({
            data: {
                id: pendingLinkId,
                companyId: tenantId,
                sourceType: "cash_flow_entry",
                sourceId: entryId,
                targetType: pendingMatch.type,
                targetId: pendingMatch.id,
                matchedAmount: amount,
                // pending/null deductFrom must not alter the forecast
                deductFrom: null
            }
        });
    }

    // Trigger AI background proposer safely
    try {
        waitUntil(proposeReconciliations(tenantId).catch((err: any) => console.error("AI Reconciliation failed:", err)));
    } catch (e) {
        console.error("Failed to schedule AI Reconciliation via waitUntil:", e);
        // Fallback for non-vercel envs or error
        proposeReconciliations(tenantId).catch((err: any) => console.error("AI Reconciliation failed (fallback):", err));
    }

    return NextResponse.json({
        entry: createdEntry,
        pendingMatch: pendingMatch ? { ...pendingMatch, linkId: pendingLinkId } : null
    });
}
