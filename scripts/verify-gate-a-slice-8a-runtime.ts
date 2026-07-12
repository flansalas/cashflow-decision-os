import "dotenv/config";
import { NextRequest } from "next/server";
import prisma from "../src/db/prisma";
import { POST as CashCheckinPOST } from "../src/app/api/cash-checkin/route";
import { GET as ReviewGET } from "../src/app/api/review/route";
import * as tenantHelpers from "../src/lib/tenant";

async function run() {
    console.log("Creating test data for Slice 8A...");
    const companyId = "test-slice-8a-tenant";
    const d = new Date();
    // Use last week so it falls in historical range
    d.setDate(d.getDate() - 7);
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    const lastWeekStart = new Date(d.toISOString().slice(0, 10));

    try {
        await prisma.company.create({
            data: { id: companyId, name: "Slice 8A Test Company" }
        });

        const plan = await prisma.executionPlan.create({
            data: {
                companyId,
                version: 1,
                weekStart: lastWeekStart,
                status: "active",
                forecastStateJson: JSON.stringify({ weeks: [{ weekStart: lastWeekStart.toISOString() }] })
            }
        });

        const plannedAction = await prisma.actionItem.create({
            data: {
                companyId,
                executionPlanId: plan.id,
                title: "Planned Action",
                dueDate: new Date(),
                amountImpact: 100,
                status: "planned",
                ownerName: "Test",
                type: "collect_ar",
                constraintWeekStart: lastWeekStart,
                priority: "p1",
                impactCertainty: "high",
                description: "Test description",
                reasoningJson: "{}",
                targetType: "invoice",
                targetId: "inv-1"
            }
        });

        const completedAction = await prisma.actionItem.create({
            data: {
                companyId,
                executionPlanId: plan.id,
                title: "Completed Action",
                dueDate: new Date(),
                amountImpact: 200,
                status: "completed",
                ownerName: "Test",
                type: "collect_ar",
                constraintWeekStart: lastWeekStart,
                priority: "p1",
                impactCertainty: "high",
                description: "Test description",
                reasoningJson: "{}",
                targetType: "invoice",
                targetId: "inv-2"
            }
        });

        const cancelledAction = await prisma.actionItem.create({
            data: {
                companyId,
                executionPlanId: plan.id,
                title: "Cancelled Action",
                dueDate: new Date(),
                amountImpact: 300,
                status: "cancelled",
                ownerName: "Test",
                type: "collect_ar",
                constraintWeekStart: lastWeekStart,
                priority: "p1",
                impactCertainty: "high",
                description: "Test description",
                reasoningJson: "{}",
                targetType: "invoice",
                targetId: "inv-3"
            }
        });

        console.log("Running cash checkin...");
        const req = new NextRequest(`http://localhost:3000/api/cash-checkin?companyId=${companyId}`, {
            method: "POST",
            body: JSON.stringify({
                companyId,
                executionPlanId: plan.id,
                bankBalance: 1000,
                asOfDate: new Date().toISOString()
            })
        });

        const res = await CashCheckinPOST(req);
        if (res.status !== 200) {
            throw new Error(`Checkin failed: ${await res.text()}`);
        }

        console.log("Verifying action item status...");
        const actions = await prisma.actionItem.findMany({ where: { executionPlanId: plan.id } });
        const pAction = actions.find(a => a.id === plannedAction.id);
        const cAction = actions.find(a => a.id === completedAction.id);
        const xAction = actions.find(a => a.id === cancelledAction.id);

        if (pAction?.status !== "missed") throw new Error("Planned action did not transition to missed");
        if (cAction?.status !== "completed") throw new Error("Completed action was incorrectly modified");
        if (xAction?.status !== "cancelled") throw new Error("Cancelled action was incorrectly modified");
        console.log("✅ Checkin transition successful");

        console.log("Running review API...");
        const req2 = new NextRequest(`http://localhost:3000/api/review?companyId=${companyId}`);
        const res2 = await ReviewGET(req2);
        if (res2.status !== 200) {
            throw new Error(`Review API failed: ${await res2.text()}`);
        }

        const data = await res2.json();
        const histPlan = data.historical.find((h: any) => h.weekStart === lastWeekStart.toISOString());
        if (!histPlan) throw new Error("Historical plan not found in review API");
        if (!histPlan.actions || histPlan.actions.length !== 3) {
            throw new Error(`Expected 3 historical actions, found ${histPlan.actions?.length}`);
        }
        console.log("✅ Historical review payload successful");
        
    } finally {
        console.log("Cleaning up test data...");
        await prisma.company.deleteMany({
            where: { id: companyId }
        });
        await prisma.$disconnect();
    }
}

run().catch(e => {
    console.error(e);
    process.exit(1);
});
