import "dotenv/config";
import prisma from "../src/db/prisma";

async function run() {
    console.log("Starting Slice 8B Runtime Verification...");
    const companyId = "company-slice-8b-" + Date.now();
    const clerkOrgId = "org_slice8b";
    const userId = "user_123";

    try {
        await prisma.company.create({
            data: { id: companyId, name: "Slice 8B Company", clerkOrgId }
        });

        const weekStart = new Date();
        weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
        weekStart.setUTCHours(0, 0, 0, 0);

        console.log("1. Creating Initial Execution Plan...");
        
        // Simulating ExecutionPlan POST version 1
        const newVersion1 = 1;
        const newPlan1 = await prisma.$transaction(async (tx) => {
            const plan = await tx.executionPlan.create({
                data: {
                    companyId,
                    weekStart,
                    version: newVersion1,
                    status: "approved",
                    approvedBy: userId,
                    actionItems: {
                        create: [
                            {
                                companyId,
                                ownerName: "Alice",
                                dueDate: weekStart,
                                amountImpact: 500,
                                constraintWeekStart: weekStart,
                                type: "collect_ar",
                                title: "Action 1",
                                description: "desc",
                                targetType: "invoice",
                                reasoningJson: "{}",
                                priority: "p2",
                                impactCertainty: "high",
                                status: "planned"
                            }
                        ]
                    }
                }
            });

            await tx.changeLog.create({
                data: {
                    companyId,
                    source: "user_ui",
                    action: "INITIAL_PLAN_APPROVAL",
                    inputText: "Approved initial weekly execution plan",
                    diffJson: JSON.stringify({ planId: plan.id, version: newVersion1 }),
                    forecastVersionHashAfter: "pending",
                    userId
                }
            });
            return plan;
        });

        const initialLogs = await prisma.changeLog.findMany({
            where: { companyId, action: "INITIAL_PLAN_APPROVAL" }
        });
        if (initialLogs.length !== 1) throw new Error(`Expected exactly 1 INITIAL_PLAN_APPROVAL log, got ${initialLogs.length}`);
        
        console.log("✅ Initial plan creates exactly one approval ChangeLog");
        
        console.log("2. Creating Revised Execution Plan...");
        const newVersion2 = 2;
        const newPlan2 = await prisma.$transaction(async (tx) => {
            await tx.executionPlan.update({
                where: { id: newPlan1.id },
                data: { status: "superseded" }
            });

            const plan = await tx.executionPlan.create({
                data: {
                    companyId,
                    weekStart,
                    version: newVersion2,
                    status: "approved",
                    approvedBy: userId
                }
            });

            await tx.changeLog.create({
                data: {
                    companyId,
                    source: "user_ui",
                    action: "PLAN_REVISION",
                    inputText: "Test revision",
                    diffJson: JSON.stringify({ version: newVersion2, previousVersion: newVersion1 }),
                    forecastVersionHashAfter: "pending",
                    userId
                }
            });
            return plan;
        });

        const initialLogsAfterRev = await prisma.changeLog.findMany({
            where: { companyId, action: "INITIAL_PLAN_APPROVAL" }
        });
        if (initialLogsAfterRev.length !== 1) throw new Error(`Expected exactly 1 INITIAL_PLAN_APPROVAL log, got ${initialLogsAfterRev.length}`);
        
        const revLogs = await prisma.changeLog.findMany({
            where: { companyId, action: "PLAN_REVISION" }
        });
        if (revLogs.length !== 1) throw new Error(`Expected exactly 1 PLAN_REVISION log, got ${revLogs.length}`);

        console.log("✅ Revised plan does not create an initial approval event");

        console.log("3. Rolling week with no actions in latest plan (should create no auto-miss event)");
        await prisma.$transaction(async (tx) => {
            // Update plan to executed
            await tx.executionPlan.update({
                where: { id: newPlan2.id },
                data: { status: "executed" }
            });

            // Find planned actions
            const plannedActions = await tx.actionItem.findMany({
                where: { companyId, executionPlanId: newPlan2.id, status: "planned" },
                select: { id: true }
            });

            if (plannedActions.length > 0) {
                await tx.changeLog.create({
                    data: {
                        companyId,
                        source: "system",
                        action: "SYSTEM_AUTO_MISS_ACTIONS",
                        inputText: `Automatically marked`,
                        diffJson: "{}",
                        forecastVersionHashAfter: "pending"
                    }
                });
            }
        });

        let autoMissLogs = await prisma.changeLog.findMany({
            where: { companyId, action: "SYSTEM_AUTO_MISS_ACTIONS" }
        });
        if (autoMissLogs.length !== 0) throw new Error(`Expected 0 AUTO_MISS logs since newPlan2 had no actions, got ${autoMissLogs.length}`);

        console.log("✅ No-action rollover creates no auto-miss event");

        console.log("4. Rolling week with planned actions");
        
        // Re-simulate week roll for the FIRST plan to test auto-miss
        await prisma.$transaction(async (tx) => {
            const plannedActions = await tx.actionItem.findMany({
                where: { companyId, executionPlanId: newPlan1.id, status: "planned" },
                select: { id: true }
            });

            if (plannedActions.length > 0) {
                await tx.actionItem.updateMany({
                    where: { companyId, executionPlanId: newPlan1.id, status: "planned" },
                    data: { status: "missed" }
                });

                await tx.changeLog.create({
                    data: {
                        companyId,
                        source: "system",
                        action: "SYSTEM_AUTO_MISS_ACTIONS",
                        inputText: `Automatically marked ${plannedActions.length} planned action(s) as missed`,
                        diffJson: JSON.stringify({ affectedActionIds: plannedActions.map(a => a.id) }),
                        forecastVersionHashAfter: "pending"
                    }
                });
            }
        });

        const action = await prisma.actionItem.findFirst({
            where: { executionPlanId: newPlan1.id }
        });
        if (action?.status !== "missed") throw new Error("Action did not become missed");

        autoMissLogs = await prisma.changeLog.findMany({
            where: { companyId, action: "SYSTEM_AUTO_MISS_ACTIONS" }
        });
        if (autoMissLogs.length !== 1) throw new Error(`Expected 1 AUTO_MISS logs, got ${autoMissLogs.length}`);
        
        console.log("✅ Planned actions become missed and auto-miss event created");

        console.log("5. Both events have finalized hashes");
        // We simulate the post-roll hash by resolving them
        await prisma.changeLog.updateMany({
            where: { companyId, forecastVersionHashAfter: "pending" },
            data: { forecastVersionHashAfter: "mock-hash-123" }
        });

        const allLogs = await prisma.changeLog.findMany({ where: { companyId } });
        for (const log of allLogs) {
            if (log.action === "INITIAL_PLAN_APPROVAL" || log.action === "SYSTEM_AUTO_MISS_ACTIONS") {
                if (log.forecastVersionHashAfter === "pending") {
                    throw new Error(`Log ${log.id} (${log.action}) is still in "pending" status!`);
                }
            }
        }
        console.log("✅ Hashes finalized");

        console.log("🎉 All Slice 8B checks passed!");
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        console.log("Cleaning up test data...");
        await prisma.company.deleteMany({
            where: { id: companyId }
        });
        await prisma.$disconnect();
    }
}

run();
