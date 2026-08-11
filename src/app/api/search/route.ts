export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";
import { getManagerialVisibility } from "@/services/managerial-visibility";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() || "";

    const companyId = await resolveTenant(req);
    if (!companyId) return NextResponse.json({ results: [] });

    if (!q || q.length < 2) {
        return NextResponse.json({ results: [] });
    }

    const isNumeric = !isNaN(Number(q.replace(/[^0-9.]/g, "")));
    const amountQuery = isNumeric ? Number(q.replace(/[^0-9.]/g, "")) : null;

    const results = [];
    const visibility = await getManagerialVisibility(companyId);

    // 1. Search AR (ReceivableInvoices)
    const arQuery: any = { companyId, id: { notIn: [...visibility.hiddenInvoiceIds] } };
    if (amountQuery) {
        // search +/- 1%
        const min = amountQuery * 0.99;
        const max = amountQuery * 1.01;
        arQuery.amountOpen = { gte: min, lte: max };
    } else {
        arQuery.OR = [
            { customerName: { contains: q, mode: "insensitive" } },
            { invoiceNo: { contains: q, mode: "insensitive" } },
        ];
    }
    const arMatches = await prisma.receivableInvoice.findMany({ where: arQuery, take: 10 });
    for (const ar of arMatches) {
        // Try to guess week, but easier to just link to cashflow page and let it scroll
        results.push({
            id: ar.id,
            type: "AR Receipt",
            label: `${ar.customerName} (${ar.invoiceNo})`,
            amount: ar.amountOpen,
            color: "emerald",
            url: `/receivables?highlightId=${ar.id}`,
            dateInfo: ar.dueDate ? new Date(ar.dueDate).toLocaleDateString() : ar.invoiceDate ? new Date(ar.invoiceDate).toLocaleDateString() : "No date",
            status: ar.status
        });
    }

    // 2. Search AP (PayableBills)
    const apQuery: any = { companyId, id: { notIn: [...visibility.hiddenBillIds] } };
    if (amountQuery) {
        const min = amountQuery * 0.99;
        const max = amountQuery * 1.01;
        apQuery.amountOpen = { gte: min, lte: max };
    } else {
        apQuery.OR = [
            { vendorName: { contains: q, mode: "insensitive" } },
            { billNo: { contains: q, mode: "insensitive" } },
        ];
    }
    const apMatches = await prisma.payableBill.findMany({ where: apQuery, take: 10 });
    for (const ap of apMatches) {
        results.push({
            id: ap.id,
            type: "AP Bill",
            label: `${ap.vendorName} (${ap.billNo})`,
            amount: ap.amountOpen,
            color: "rose",
            url: `/payables?highlightId=${ap.id}`,
            dateInfo: ap.dueDate ? new Date(ap.dueDate).toLocaleDateString() : "No date",
            status: ap.status
        });
    }

    // 3. Search Recurring
    const recQuery: any = { companyId, isIncluded: true };
    if (amountQuery) {
        const min = amountQuery * 0.90; // Wider net for recurring averages
        const max = amountQuery * 1.10;
        recQuery.typicalAmount = { gte: min, lte: max };
    } else {
        recQuery.OR = [
            { displayName: { contains: q, mode: "insensitive" } },
            { merchantKey: { contains: q, mode: "insensitive" } },
            { category: { contains: q, mode: "insensitive" } },
        ];
    }
    const recMatches = await prisma.recurringPattern.findMany({ where: recQuery, take: 5 });
    for (const rec of recMatches) {
        results.push({
            id: rec.id,
            type: "Recurring " + (rec.direction === "inflow" ? "In" : "Out"),
            label: rec.displayName,
            amount: rec.typicalAmount,
            color: "indigo",
            url: `/planned?highlightId=${rec.id}`,
            dateInfo: `Cadence: ${rec.cadence}`,
            status: "active"
        });
    }

    // 4. Search CashAdjustments (One-Time)
    const adjQuery: any = { companyId };
    if (amountQuery) {
        const min = amountQuery * 0.99;
        const max = amountQuery * 1.01;
        adjQuery.OR = [
            { amount: { gte: min, lte: max } },
            { amount: { gte: -max, lte: -min } }
        ];
    } else {
        adjQuery.OR = [
            { note: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
        ];
    }
    const adjMatches = await prisma.cashAdjustment.findMany({ where: adjQuery, take: 5 });
    for (const adj of adjMatches) {
        // determine if past based on effectiveDate
        const isPast = new Date(adj.effectiveDate) < new Date(new Date().setHours(0,0,0,0));
        results.push({
            id: adj.id,
            type: "One-Time " + (adj.amount > 0 ? "In" : "Out"),
            label: adj.note || "Adjustment",
            amount: Math.abs(adj.amount),
            color: adj.amount > 0 ? "emerald" : "rose",
            url: `/planned?highlightId=${adj.id}`,
            dateInfo: `Date: ${new Date(adj.effectiveDate).toLocaleDateString()}`,
            status: isPast ? "completed" : "active"
        });
    }

    return NextResponse.json({ results });
}
