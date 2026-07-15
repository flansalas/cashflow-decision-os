import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export async function POST(req: NextRequest) {
    try {
        const companyId = await resolveTenant(req);
        if (!companyId) return NextResponse.json({ error: "Could not resolve company" }, { status: 401 });

        const body = await req.json();
        const { type, direction, name, amount, category, date, cadence } = body;

        if (!name || !amount || !date || !direction) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        if (type === "recurring") {
            const created = await prisma.recurringPattern.create({
                data: {
                    companyId,
                    merchantKey: name,
                    displayName: name,
                    typicalAmount: amount,
                    direction,
                    cadence,
                    nextExpectedDate: new Date(date),
                    category,
                    confidence: "high", // manual entry
                    isIncluded: true,
                    isCritical: false,
                    status: "active",
                    origin: "user"
                }
            });
            return NextResponse.json(created);
        } else {
            // One-time
            const created = await prisma.cashAdjustment.create({
                data: {
                    companyId,
                    type: category || "other",
                    amount: direction === "outflow" ? -Math.abs(amount) : Math.abs(amount),
                    note: name,
                    effectiveDate: new Date(date),
                    status: "active",
                    origin: "user"
                }
            });
            return NextResponse.json(created);
        }
    } catch (e) {
        console.error("Failed to create planned event:", e);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
