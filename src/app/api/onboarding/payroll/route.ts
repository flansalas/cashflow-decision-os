// POST /api/onboarding/payroll
// Step 2: Save payroll fields to Assumption row, advance onboardingStep to 2.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function POST(req: NextRequest) {
    const { companyId, cadence, allInAmount, nextDate } = await req.json() as {
        companyId: string;
        cadence: "weekly" | "biweekly" | "monthly";
        allInAmount: number;
        nextDate: string;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!allInAmount || allInAmount <= 0) {
        return NextResponse.json({ error: "Payroll amount is required" }, { status: 400 });
    }
    if (!nextDate) {
        return NextResponse.json({ error: "Next pay date is required" }, { status: 400 });
    }

    const nextDateParsed = new Date(nextDate);

    try {
        const existing = await prisma.assumption.findFirst({ where: { companyId } });

        if (existing) {
            await prisma.assumption.update({
                where: { id: existing.id },
                data: {
                    payrollCadence: cadence ?? "biweekly",
                    payrollAllInAmount: allInAmount,
                    payrollNextDate: nextDateParsed,
                },
            });
        } else {
            await prisma.assumption.create({
                data: {
                    companyId,
                    payrollCadence: cadence ?? "biweekly",
                    payrollAllInAmount: allInAmount,
                    payrollNextDate: nextDateParsed,
                },
            });
        }

        await prisma.company.update({
            where: { id: companyId },
            data: { onboardingStep: 2 },
        });

        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Onboarding payroll error:", error);
        return NextResponse.json({ error: "Failed to save payroll" }, { status: 500 });
    }
}
