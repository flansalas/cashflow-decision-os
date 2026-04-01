import { NextResponse } from "next/server";
import { prisma } from "@/db/prisma";

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q")?.trim() || "";
    // Note: in a real app, companyId should come from the session or request. 
    // We'll use the one from query param or fallback to the first active one, just like other APIs here.
    let companyId = searchParams.get("companyId");

    if (!companyId) {
        const firstCo = await prisma.company.findFirst({ select: { id: true } });
        if (!firstCo) return NextResponse.json({ results: [] });
        companyId = firstCo.id;
    }

    if (!q || q.length < 2) {
        return NextResponse.json({ results: [] });
    }

    const isNumeric = !isNaN(Number(q.replace(/[^0-9.]/g, "")));
    const amountQuery = isNumeric ? Number(q.replace(/[^0-9.]/g, "")) : null;

    const results = [];

    // 1. Search AR (ReceivableInvoices)
    const arQuery: any = { companyId, status: "open" };
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
            url: `/cashflow?highlightId=${ar.id}`,
            dateInfo: ar.dueDate ? new Date(ar.dueDate).toLocaleDateString() : ar.invoiceDate ? new Date(ar.invoiceDate).toLocaleDateString() : "No date",
        });
    }

    // 2. Search AP (PayableBills)
    const apQuery: any = { companyId, status: "open" };
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
            url: `/cashflow?highlightId=${ap.id}`,
            dateInfo: ap.dueDate ? new Date(ap.dueDate).toLocaleDateString() : "No date",
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
            url: `/recurring`,
            dateInfo: `Cadence: ${rec.cadence}`,
        });
    }

    return NextResponse.json({ results });
}
