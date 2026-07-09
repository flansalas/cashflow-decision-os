const fs = require('fs');
let code = fs.readFileSync('src/app/api/cash-checkin/route.ts', 'utf8');

if (!code.includes('resolveTenant')) {
    code = code.replace(
        'import { NextRequest, NextResponse } from "next/server";',
        'import { NextRequest, NextResponse } from "next/server";\nimport { resolveTenant } from "@/lib/tenant";'
    );
}

// Replace body schema and extraction
code = code.replace(
    /const body = await req\.json\(\) as \{[\s\S]*?\};\n\n    const \{ companyId, bankBalance, asOfDate, adjustments = \[\], priorWeekForecast \} = body;/m,
    `const body = await req.json() as {
        companyId?: string;
        executionPlanId?: string;
        bankBalance: number;
        asOfDate?: string;
        adjustments?: Array<{ type: string; amount: number; note: string | null }>;
        priorWeekForecast?: {
            forecastVersionHash?: string;
            generatedAt?: string;
            weekStart: string;
            weekEnd: string;
            endCashExpected: number;
            inflowsExpected: number;
            outflowsExpected: number;
            breakdownJson?: string;
        };
    };

    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Missing or invalid company" }, { status: 401 });
    const companyId = tenantId;

    const { executionPlanId, bankBalance, asOfDate, adjustments = [], priorWeekForecast } = body;`
);

// Append ExecutionPlan update
code = code.replace(
    'return NextResponse.json(coreResult);',
    `
        // ── Mark ExecutionPlan as Reviewed (Atomic-ish with the roll) ───────
        if (executionPlanId) {
            try {
                await prisma.executionPlan.update({
                    where: { id: executionPlanId, companyId },
                    data: {
                        status: "executed",
                        reviewedAt: new Date(),
                        actualEndingCash: coreResult.snapshot.bankBalance + coreResult.snapshot.adjustmentsTotal
                    }
                });
            } catch (epErr) {
                console.error("Failed to mark ExecutionPlan reviewed:", epErr);
                // We do not fail the roll if this fails, but it's part of the check-in
            }
        } else if (priorWeekForecast?.weekStart) {
            // Fallback: find the latest plan for the rolled week
            try {
                const plans = await prisma.executionPlan.findMany({
                    where: { companyId, weekStart: new Date(priorWeekForecast.weekStart) },
                    orderBy: { version: 'desc' },
                    take: 1
                });
                if (plans.length > 0) {
                    await prisma.executionPlan.update({
                        where: { id: plans[0].id },
                        data: {
                            status: "executed",
                            reviewedAt: new Date(),
                            actualEndingCash: coreResult.snapshot.bankBalance + coreResult.snapshot.adjustmentsTotal
                        }
                    });
                }
            } catch (fallbackErr) {
                console.error("Fallback ExecutionPlan update failed:", fallbackErr);
            }
        }

        return NextResponse.json(coreResult);`
);

fs.writeFileSync('src/app/api/cash-checkin/route.ts', code);
