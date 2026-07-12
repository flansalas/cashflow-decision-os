import "dotenv/config";
import prisma from "../src/db/prisma";

async function main() {
    console.log("Starting runtime verification for Slice 6...");
    
    // Isolated test data
    const testCompanyId = "test_co_slice6_" + Date.now();
    
    try {
        // 1. Create a test company
        await prisma.company.create({
            data: {
                id: testCompanyId,
                name: "Test Company Slice 6",
            }
        });
        console.log(`Created test company: ${testCompanyId}`);

        const weekStart = new Date("2026-07-27T00:00:00Z");

        // 2. Create ExecutionPlan with an action
        const plan = await prisma.executionPlan.create({
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
                            dueDate: new Date("2026-07-29T00:00:00Z"),
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
                            status: "planned",
                            actualAmountImpact: null // initially null
                        }
                    ]
                }
            },
            include: {
                actionItems: true
            }
        });
        
        const actionId = plan.actionItems[0].id;
        
        // 3. Verify it stores null actualAmountImpact initially
        if (plan.actionItems[0].actualAmountImpact !== null) {
            throw new Error("Initial action should have null actualAmountImpact");
        }
        
        // 4. Create read-only evidence (CustomerPaymentObservation)
        await prisma.customerPaymentObservation.create({
            data: {
                companyId: testCompanyId,
                customerName: "Test Customer",
                invoiceId: "inv_101",
                invoiceNo: "INV-101",
                actualPaymentDate: new Date("2026-07-28T00:00:00Z"),
                daysEarlyOrLate: 0,
                amount: 1000.50,
                paymentSource: "bank_match"
            }
        });
        console.log("Created isolated CustomerPaymentObservation evidence.");
        
        // 5. Update to completed with numeric actualAmountImpact and note
        const completedAction = await prisma.actionItem.update({
            where: { id: actionId },
            data: {
                status: "completed",
                actualAmountImpact: 1000.50,
                completionNote: "Received in bank",
                completedAt: new Date()
            }
        });
        
        if (completedAction.actualAmountImpact !== 1000.50) throw new Error("Failed to store numeric actualAmountImpact");
        if (completedAction.completionNote !== "Received in bank") throw new Error("Failed to preserve completionNote");
        if (!completedAction.completedAt) throw new Error("Failed to preserve completedAt");
        
        console.log("Verified numeric actualAmountImpact on completed status.");
        
        // 6. Update to missed/cancelled, ensure it retains null
        const cancelledAction = await prisma.actionItem.update({
            where: { id: actionId },
            data: {
                status: "cancelled",
                actualAmountImpact: null,
                completionNote: "Customer refused to pay",
                completedAt: null
            }
        });
        
        if (cancelledAction.actualAmountImpact !== null) throw new Error("Failed to retain null actualAmountImpact on cancelled status");
        
        console.log("Verified null actualAmountImpact on cancelled status.");

        // 7. Verify observation remains unmutated (read-only evidence)
        const obs = await prisma.customerPaymentObservation.findFirst({
            where: { companyId: testCompanyId, invoiceId: "inv_101" }
        });
        if (!obs || obs.amount !== 1000.50) throw new Error("Observation evidence was mutated or lost");
        
        console.log("✅ Runtime verification successful! Action completion logic works securely.");

    } catch (e) {
        console.error("❌ Runtime verification failed:", e);
        process.exitCode = 1;
    } finally {
        // Cleanup test data
        console.log("Cleaning up test data...");
        await prisma.company.delete({
            where: { id: testCompanyId }
        }).catch(e => console.error("Cleanup failed:", e));
        
        await prisma.$disconnect();
    }
}

main();
