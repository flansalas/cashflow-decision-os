import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { assembleForecastData } from "@/services/forecast-assembly";
import { getAuditReason } from "@/utils/audit-helpers";
import { resolveTenant } from "@/lib/tenant";


export async function GET(req: NextRequest) {
    const tenantId = await resolveTenant(req);
    if (!tenantId) return NextResponse.json({ error: "Missing or invalid company" }, { status: 401 });
    const companyId = tenantId;

    try {
        // Find current week (assumes week starts on Sunday)
        const d = new Date();
        const day = d.getUTCDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setUTCDate(d.getUTCDate() + diff);
        const currentWeekStart = new Date(d.toISOString().slice(0, 10));

        // Get ExecutionPlans for this week
        const plans = await prisma.executionPlan.findMany({
            where: { companyId, weekStart: currentWeekStart },
            orderBy: { version: 'asc' }
        });

        let originalPlan = plans.length > 0 ? plans[0] : null;
        let revisedPlan = plans.length > 1 ? plans[plans.length - 1] : null;


        // Get Cash state
        const [cashSnapshot, adjustments] = await Promise.all([
            prisma.cashSnapshot.findFirst({ where: { companyId }, orderBy: { asOfDate: "desc" } }),
            prisma.cashAdjustment.findMany({ where: { companyId } })
        ]);
        const cash = {
            bankBalance: cashSnapshot?.bankBalance || 0,
            adjustments: adjustments.map(a => ({ type: a.type, amount: a.amount, note: a.note }))
        };
        const lastUpdated = cashSnapshot?.asOfDate ? cashSnapshot.asOfDate.toISOString() : null;



        // Get Live Forecast
        const forecast = await assembleForecastData(companyId);
        const latestForecast = forecast.forecastResult.weeks.find(w => new Date(w.weekStart).getTime() === currentWeekStart.getTime()) || null;

        // Get Historical Reviews (last 13 weeks)
        const historicalPlans = await prisma.executionPlan.findMany({
            where: {
                companyId,
                reviewedAt: { not: null },
                weekStart: { lt: currentWeekStart }
            },
            orderBy: { weekStart: 'desc', version: 'asc' },
        });

        // Group historical by weekStart
        const historicalByWeek = new Map<string, any[]>();
        historicalPlans.forEach(p => {
            const w = p.weekStart.toISOString();
            if (!historicalByWeek.has(w)) historicalByWeek.set(w, []);
            historicalByWeek.get(w)!.push(p);
        });

        const historicalReviews = [];
        for (const [w, wPlans] of Array.from(historicalByWeek.entries()).slice(0, 13)) {
            const weekStart = new Date(w);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 7);

            // find checkpoint
            const checkpoint = await prisma.forecastCheckpoint.findFirst({
                where: { companyId, weekStart },
                orderBy: { generatedAt: 'desc' },
                include: { cashSnapshot: true }
            });

            const actualEndingCash = checkpoint?.cashSnapshot?.bankBalance ?? wPlans[wPlans.length - 1]?.actualEndingCash ?? 0;

            const priorWeekStart = new Date(weekStart);
            priorWeekStart.setDate(priorWeekStart.getDate() - 7);
            const priorCheckpoint = await prisma.forecastCheckpoint.findFirst({
                where: { companyId, weekStart: priorWeekStart },
                orderBy: { generatedAt: 'desc' },
                include: { cashSnapshot: true }
            });

            let actualStartCash = priorCheckpoint?.cashSnapshot?.bankBalance;
            if (actualStartCash === undefined) {
                const fallbackSnapshot = await prisma.cashSnapshot.findFirst({
                    where: { companyId, asOfDate: { lte: weekStart } },
                    orderBy: { asOfDate: 'desc' }
                });
                actualStartCash = fallbackSnapshot?.bankBalance ?? 0;
            }

            const txs = await prisma.bankTransaction.groupBy({
                by: ['direction'],
                where: {
                    companyId,
                    txDate: { gte: weekStart, lt: weekEnd }
                },
                _sum: { amount: true }
            });

            const actualInflows = txs.find(t => t.direction === 'inflow')?._sum.amount ?? 0;
            const actualOutflows = txs.find(t => t.direction === 'outflow')?._sum.amount ?? 0;

            const reconciliationDifference = actualEndingCash - (actualStartCash + actualInflows - actualOutflows);

            historicalReviews.push({
                weekStart: w,
                originalPlan: wPlans[0],
                revisedPlan: wPlans.length > 1 ? wPlans[wPlans.length - 1] : null,
                checkpoint,
                actuals: {
                    startCash: actualStartCash,
                    inflowsExpected: actualInflows,
                    outflowsExpected: actualOutflows,
                    endCashExpected: actualEndingCash,
                    reconciliationDifference
                }
            });
        }

        // Get Post-approval changes (AuditLog)
        let changes: any[] = [];
        const latestPlanDate = revisedPlan ? revisedPlan.createdAt : (originalPlan ? originalPlan.createdAt : null);
        if (latestPlanDate) {
            const rawChanges = await prisma.changeLog.findMany({
                where: {
                    companyId,
                    timestamp: { gte: latestPlanDate }
                },
                orderBy: { timestamp: 'asc' }
            });
            changes = rawChanges.map(c => ({
                ...c,
                reason: getAuditReason(c)
            }));
        }

        return NextResponse.json({
            active: {
                weekStart: currentWeekStart,
                originalPlan,
                revisedPlan,
                latestForecast,
                changes
            },
            historical: historicalReviews,
            cash,
            lastUpdated
        });
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
