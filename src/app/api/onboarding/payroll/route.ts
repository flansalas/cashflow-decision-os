export const dynamic = 'force-dynamic';
// POST /api/onboarding/payroll
// Step 2: Save payroll fields to Assumption row, advance onboardingStep to 2.
// Tenant authority: derived exclusively from authenticated Clerk organization.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import prisma from "@/db/prisma";

export async function POST(req: NextRequest) {
    const authResult = await auth();
    if (!authResult?.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { companyId: bodyCompanyId, cadence, allInAmount, nextDate } = await req.json() as {
        companyId?: string;
        cadence: "weekly" | "biweekly" | "monthly";
        allInAmount: number;
        nextDate: string;
    };

    if (bodyCompanyId && bodyCompanyId !== tenantId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const companyId = tenantId;

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
