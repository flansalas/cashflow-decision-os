import "dotenv/config";
import prisma from "../src/db/prisma";

async function main() {
    const companyId = "test-company-" + Date.now();
    
    try {
        // Create company
        await prisma.company.create({ data: { id: companyId, name: "Test Company" } });

        const week0Start = new Date("2024-01-07T00:00:00Z"); // prior week
        const week1Start = new Date("2024-01-14T00:00:00Z"); // target week
        const week1End = new Date("2024-01-21T00:00:00Z");

        // Create prior week snapshot and checkpoint
        const snap0 = await prisma.cashSnapshot.create({
            data: { companyId, bankBalance: 10000, asOfDate: new Date("2024-01-13T23:59:59Z") }
        });
        await prisma.forecastCheckpoint.create({
            data: {
                companyId,
                cashSnapshotId: snap0.id,
                weekStart: week0Start,
                weekEnd: week1Start,
                endCashExpected: 10000,
                inflowsExpected: 0,
                outflowsExpected: 0,
            }
        });

        // Create target week bank transactions
        await prisma.bankTransaction.createMany({
            data: [
                { companyId, txDate: new Date("2024-01-15T12:00:00Z"), amount: 5000, description: "Inflow 1", direction: "inflow" },
                { companyId, txDate: new Date("2024-01-16T12:00:00Z"), amount: 3000, description: "Outflow 1", direction: "outflow" },
                { companyId, txDate: new Date("2024-01-17T12:00:00Z"), amount: 1000, description: "Outflow 2", direction: "outflow" }
            ]
        });
        // Inflows = 5000, Outflows = 4000.
        // Mathematical end = 10000 + 5000 - 4000 = 11000.

        // Create target week snapshot and checkpoint with a discrepancy (Actual end = 12000)
        // Discrepancy = 12000 - 11000 = +1000
        const snap1 = await prisma.cashSnapshot.create({
            data: { companyId, bankBalance: 12000, asOfDate: new Date("2024-01-20T23:59:59Z") }
        });
        await prisma.forecastCheckpoint.create({
            data: {
                companyId,
                cashSnapshotId: snap1.id,
                weekStart: week1Start,
                weekEnd: week1End,
                endCashExpected: 12000,
                inflowsExpected: 5000,
                outflowsExpected: 4000,
            }
        });

        // Create ExecutionPlan for target week to ensure it's loaded as historical
        await prisma.executionPlan.create({
            data: {
                companyId,
                weekStart: week1Start,
                reviewedAt: new Date(),
                actualEndingCash: 12000
            }
        });

        // Mock GET request to /api/review
        // Instead of actually calling next, we just replicate the DB logic
        
        const historicalPlans = await prisma.executionPlan.findMany({
            where: { companyId, reviewedAt: { not: null }, weekStart: { lt: new Date("2024-01-22T00:00:00Z") } },
            orderBy: [{ weekStart: 'desc' }, { version: 'asc' }],
        });
        
        let targetActuals = null;
        for (const p of historicalPlans) {
            if (p.weekStart.getTime() !== week1Start.getTime()) continue;
            
            const w = p.weekStart.toISOString();
            const weekStart = new Date(w);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 7);

            const checkpoint = await prisma.forecastCheckpoint.findFirst({
                where: { companyId, weekStart },
                orderBy: { generatedAt: 'desc' },
                include: { cashSnapshot: true }
            });

            const actualEndingCash = checkpoint?.cashSnapshot?.bankBalance ?? p.actualEndingCash ?? 0;

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
                    orderBy: [{ asOfDate: 'desc' }, { createdAt: 'desc' }]
                });
                actualStartCash = fallbackSnapshot?.bankBalance ?? 0;
            }

            const txs = await prisma.bankTransaction.groupBy({
                by: ['direction'],
                where: { companyId, txDate: { gte: weekStart, lt: weekEnd } },
                _sum: { amount: true }
            });
            
            const actualInflows = txs.find(t => t.direction === 'inflow')?._sum.amount ?? 0;
            const actualOutflows = txs.find(t => t.direction === 'outflow')?._sum.amount ?? 0;

            const reconciliationDifference = actualEndingCash - (actualStartCash + actualInflows - actualOutflows);
            
            targetActuals = {
                startCash: actualStartCash,
                inflowsExpected: actualInflows,
                outflowsExpected: actualOutflows,
                endCashExpected: actualEndingCash,
                reconciliationDifference
            };
        }

        console.log("Calculated Actuals:", targetActuals);

        if (targetActuals?.startCash !== 10000) throw new Error("startCash mismatch");
        if (targetActuals?.inflowsExpected !== 5000) throw new Error("inflows mismatch");
        if (targetActuals?.outflowsExpected !== 4000) throw new Error("outflows mismatch");
        if (targetActuals?.endCashExpected !== 12000) throw new Error("endCash mismatch");
        if (targetActuals?.reconciliationDifference !== 1000) throw new Error("reconciliation mismatch");

        console.log("PASS");
    } finally {
        console.log("Cleaning up test data...");
        await prisma.company.delete({ where: { id: companyId } }).catch(err => {
            console.error("Cleanup failed:", err);
        });
        const companyExists = await prisma.company.findUnique({ where: { id: companyId } });
        if (companyExists) {
            console.error("FAIL: Cleanup verification failed, company still exists.");
            process.exit(1);
        } else {
            console.log("Cleanup verified successfully.");
        }
    }
}

main().catch(e => {
    console.error("FAIL", e);
    process.exit(1);
});
