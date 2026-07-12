import "dotenv/config";
import prisma from "../src/db/prisma";

async function main() {
    
    // Isolated test data
    const testCompanyId = "test_co_slice5_" + Date.now();
    
    try {
        // 1. Create a test company
        await prisma.company.create({
            data: {
                id: testCompanyId,
                name: "Test Company Slice 5",
            }
        });
        console.log(`Created test company: ${testCompanyId}`);

        const weekStart = new Date("2026-07-20T00:00:00Z");

        // 2. Create ExecutionPlan with actions
        const plan1 = await prisma.executionPlan.create({
            data: {
                companyId: testCompanyId,
                weekStart: weekStart,
                version: 1,
                status: "approved",
                approvedBy: "test_user",
                actionItems: {
                    create: [
                        {
                            companyId: testCompanyId,
                            ownerName: "Alice",
                            dueDate: new Date("2026-07-22T00:00:00Z"),
                            amountImpact: 1000.50, // Positive for AR
                            constraintWeekStart: weekStart,
                            type: "collect_ar",
                            title: "Collect Invoice 101",
                            description: "Follow up on Invoice 101",
                            targetType: "invoice",
                            targetId: "inv_101",
                            reasoningJson: JSON.stringify({ source: "collectionTargets" }),
                            priority: "p2",
                            impactCertainty: "med",
                            status: "planned"
                        },
                        {
                            companyId: testCompanyId,
                            ownerName: "Bob",
                            dueDate: new Date("2026-07-23T00:00:00Z"),
                            amountImpact: -500.25, // Negative for AP
                            constraintWeekStart: weekStart,
                            type: "pay_ap",
                            title: "Pay Bill 202",
                            description: "Release payment for Bill 202",
                            targetType: "bill",
                            targetId: "bill_202",
                            reasoningJson: JSON.stringify({ source: "approvedToPay" }),
                            priority: "p1",
                            impactCertainty: "high",
                            status: "planned"
                        }
                    ]
                }
            },
            include: {
                actionItems: true
            }
        });
        console.log(`Created ExecutionPlan version 1 with ${plan1.actionItems.length} actions.`);
        
        if (plan1.actionItems.length !== 2) throw new Error("Expected 2 action items.");
        const actionAR = plan1.actionItems.find(a => a.type === "collect_ar");
        const actionAP = plan1.actionItems.find(a => a.type === "pay_ap");
        
        if (!actionAR || actionAR.ownerName !== "Alice" || actionAR.amountImpact !== 1000.50 || actionAR.status !== "planned") {
            throw new Error("Action AR failed assertion.");
        }
        if (!actionAP || actionAP.ownerName !== "Bob" || actionAP.amountImpact !== -500.25 || actionAP.status !== "planned") {
            throw new Error("Action AP failed assertion.");
        }

        // 3. Create a revised plan
        const plan2 = await prisma.executionPlan.create({
            data: {
                companyId: testCompanyId,
                weekStart: weekStart,
                version: 2,
                status: "approved",
                approvedBy: "test_user_2",
                revisionReason: "Updated amounts",
                actionItems: {
                    create: [
                        {
                            companyId: testCompanyId,
                            ownerName: "Charlie",
                            dueDate: new Date("2026-07-24T00:00:00Z"),
                            amountImpact: 1500,
                            constraintWeekStart: weekStart,
                            type: "defer_ap",
                            title: "Hold Bill 303",
                            description: "Do not process bill 303",
                            targetType: "bill",
                            targetId: "bill_303",
                            reasoningJson: JSON.stringify({ source: "holdItems", originalDue: "2026-07-21T00:00:00Z" }),
                            priority: "p2",
                            impactCertainty: "med",
                            status: "planned"
                        }
                    ]
                }
            },
            include: {
                actionItems: true
            }
        });
        console.log(`Created revised ExecutionPlan version 2 with ${plan2.actionItems.length} action(s).`);

        if (plan2.actionItems.length !== 1) throw new Error("Expected 1 action item for version 2.");
        
        // 4. Load plans including action items
        const loadedPlans = await prisma.executionPlan.findMany({
            where: { companyId: testCompanyId },
            orderBy: { version: 'desc' },
            include: { actionItems: true }
        });
        
        if (loadedPlans.length !== 2) throw new Error("Expected 2 loaded plans.");
        if (loadedPlans[0].version !== 2 || loadedPlans[0].actionItems.length !== 1) throw new Error("Latest plan failed assertion.");
        if (loadedPlans[1].version !== 1 || loadedPlans[1].actionItems.length !== 2) throw new Error("Previous plan failed assertion.");
        
        console.log("✅ Runtime verification successful! ExecutionPlan and ActionItems are correctly linked and preserved.");

    } catch (e) {
        console.error("❌ Runtime verification failed:", e);
        process.exitCode = 1;
    } finally {
        // Cleanup test data
        console.log("Cleaning up test data...");
        // This will cascade delete ExecutionPlans and ActionItems
        await prisma.company.delete({
            where: { id: testCompanyId }
        }).catch(e => console.error("Cleanup failed:", e));
        
        await prisma.$disconnect();
    }
}

main();
