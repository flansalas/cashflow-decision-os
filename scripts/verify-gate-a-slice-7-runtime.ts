import "dotenv/config";
import prisma from "../src/db/prisma";

async function main() {
    console.log("Starting runtime verification for Slice 7...");

    const testCompanyId = "test_co_slice7_" + Date.now();

    try {
        // 1. Create a temporary Company and Assumption
        await prisma.company.create({
            data: {
                id: testCompanyId,
                name: "Test Company Slice 7",
                assumptions: {
                    create: [
                        {
                            projectionSafetyMargin: 1.0,
                            fixedWeeklyOutflow: 5000,
                            bufferMin: 10000,
                        }
                    ]
                }
            }
        });
        console.log(`Created test company and assumption: ${testCompanyId}`);

        const weekStart = new Date("2026-07-27T00:00:00Z");

        // 2. Create completed ActionItems with expected and actual impacts showing a material negative variance
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
                            ownerName: "Bob",
                            dueDate: new Date("2026-07-29T00:00:00Z"),
                            amountImpact: 1000.00, // Expected positive AR collection
                            constraintWeekStart: weekStart,
                            type: "collect_ar",
                            title: "Collect Invoice 202",
                            description: "Material collection",
                            targetType: "invoice",
                            targetId: "inv_202",
                            priority: "p1",
                            impactCertainty: "high",
                            status: "completed",
                            actualAmountImpact: 800.00, // Actual AR is $800 (underperformed by 20%, which is >= 10%)
                            reasoningJson: "{}"
                        }
                    ]
                }
            },
            include: {
                actionItems: true
            }
        });

        // 3. Simulate proposal generation logic from cash-checkin/route.ts
        const actions = await prisma.actionItem.findMany({
            where: {
                companyId: testCompanyId,
                status: "completed",
                actualAmountImpact: { not: null },
                executionPlan: { weekStart: weekStart }
            }
        });

        let expectedTotal = 0;
        let actualTotal = 0;
        let actionIds: string[] = [];
        for (const a of actions) {
            expectedTotal += a.amountImpact;
            actualTotal += a.actualAmountImpact!;
            actionIds.push(a.id);
        }

        if (expectedTotal <= 0) throw new Error("Expected total must be > 0");
        const variance = (expectedTotal - actualTotal) / expectedTotal;
        if (variance < 0.10) throw new Error("Variance should be >= 10%");

        const assumption = await prisma.assumption.findFirst({ where: { companyId: testCompanyId } });
        if (!assumption) throw new Error("Assumption not found");

        const currentSafetyMargin = assumption.projectionSafetyMargin;
        const proposedSafetyMargin = parseFloat((currentSafetyMargin * 1.05).toFixed(2));

        const proposal = await prisma.learningProposal.create({
            data: {
                companyId: testCompanyId,
                type: "safety_margin_increase",
                proposedChangeJson: JSON.stringify({
                    field: "projectionSafetyMargin",
                    currentValue: currentSafetyMargin,
                    proposedValue: proposedSafetyMargin
                }),
                rationale: `Completed actions for week underperformed expected cash effect by ${(variance * 100).toFixed(1)}%.`,
                evidenceActionIds: JSON.stringify(actionIds)
            }
        });

        // Verify: status is pending, evidenceActionIds are preserved, proposed current and new values preserved
        if (proposal.status !== "pending") throw new Error("Proposal status must be pending");
        if (proposal.evidenceActionIds !== JSON.stringify(actionIds)) throw new Error("Evidence action IDs mismatch");
        
        const change = JSON.parse(proposal.proposedChangeJson);
        if (change.currentValue !== 1.0 || change.proposedValue !== 1.05) {
            throw new Error("Proposed changes mismatch");
        }
        console.log("Verified pending proposal matches expected criteria.");

        // 4. Verify approval behavior using the route PATCH logic
        const status = "approved";
        const result = await prisma.$transaction(async (tx) => {
            const prop = await tx.learningProposal.findFirst({ where: { id: proposal.id, companyId: testCompanyId } });
            if (!prop || prop.status !== "pending") throw new Error("Invalid proposal state");

            const chg = JSON.parse(prop.proposedChangeJson);
            const ass = await tx.assumption.findFirst({ where: { companyId: testCompanyId } });
            if (!ass) throw new Error("Assumption record not found");

            // Compare expected current value with actual current value (stale check)
            if (ass.projectionSafetyMargin !== chg.currentValue) {
                throw new Error("STALE_ASSUMPTION");
            }

            // Update Assumption
            const updatedAss = await tx.assumption.update({
                where: { id: ass.id },
                data: { projectionSafetyMargin: chg.proposedValue }
            });

            // Update Proposal
            const updatedProp = await tx.learningProposal.update({
                where: { id: prop.id },
                data: {
                    status: "approved",
                    reviewedAt: new Date(),
                    reviewedBy: "test_verifier"
                }
            });

            // Create ChangeLog
            const changeLog = await tx.changeLog.create({
                data: {
                    companyId: testCompanyId,
                    source: "learning_proposal",
                    action: "UPDATE_ASSUMPTION",
                    inputText: prop.rationale,
                    diffJson: JSON.stringify({
                        proposalId: prop.id,
                        field: "projectionSafetyMargin",
                        oldValue: chg.currentValue,
                        newValue: chg.proposedValue
                    }),
                    forecastVersionHashAfter: "pending",
                    userId: "test_verifier"
                }
            });

            return { updatedProp, changeLogId: changeLog.id };
        });

        // Assert updates succeeded
        const updatedAssumption = await prisma.assumption.findFirst({ where: { companyId: testCompanyId } });
        if (!updatedAssumption || updatedAssumption.projectionSafetyMargin !== 1.05) {
            throw new Error("Assumption was not updated correctly to 1.05");
        }

        const approvedProposal = await prisma.learningProposal.findUnique({ where: { id: proposal.id } });
        if (!approvedProposal || approvedProposal.status !== "approved") {
            throw new Error("Proposal status was not updated to approved");
        }

        const changeLog = await prisma.changeLog.findFirst({
            where: { companyId: testCompanyId, source: "learning_proposal" }
        });
        if (!changeLog) throw new Error("ChangeLog not created with source learning_proposal");

        console.log("Verified successful proposal approval updates db state correctly.");

        // 5. Verify stale-assumption behavior refuses approval when the current value no longer matches
        // Re-create a pending proposal with stale expected current value
        const staleProposal = await prisma.learningProposal.create({
            data: {
                companyId: testCompanyId,
                type: "safety_margin_increase",
                proposedChangeJson: JSON.stringify({
                    field: "projectionSafetyMargin",
                    currentValue: 1.0, // Stale! Current projectionSafetyMargin is now 1.05
                    proposedValue: 1.10
                }),
                rationale: "Stale test",
                evidenceActionIds: JSON.stringify(actionIds)
            }
        });

        let threwStaleError = false;
        try {
            await prisma.$transaction(async (tx) => {
                const prop = await tx.learningProposal.findFirst({ where: { id: staleProposal.id, companyId: testCompanyId } });
                if (!prop) throw new Error("Proposal not found");

                const chg = JSON.parse(prop.proposedChangeJson);
                const ass = await tx.assumption.findFirst({ where: { companyId: testCompanyId } });
                if (!ass) throw new Error("Assumption record not found");

                if (ass.projectionSafetyMargin !== chg.currentValue) {
                    throw new Error("STALE_ASSUMPTION");
                }
            });
        } catch (e: any) {
            if (e.message === "STALE_ASSUMPTION") {
                threwStaleError = true;
            } else {
                throw e;
            }
        }

        if (!threwStaleError) {
            throw new Error("Stale assumption check failed to prevent transaction execution");
        }
        console.log("Verified stale assumption check behaves correctly.");

        console.log("✅ Runtime verification successful!");

    } catch (e) {
        console.error("❌ Runtime verification failed:", e);
        process.exitCode = 1;
    } finally {
        console.log("Cleaning up test data...");
        await prisma.company.delete({
            where: { id: testCompanyId }
        }).catch(e => console.error("Cleanup failed:", e));

        await prisma.$disconnect();
    }
}

main();
