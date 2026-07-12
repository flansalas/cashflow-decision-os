import { NextResponse } from "next/server";
import { getAuth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveForecastHashAfter } from "@/services/forecast-hash";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { orgId, userId } = getAuth(req as any);
        if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const company = await prisma.company.findUnique({
            where: { clerkOrgId: orgId },
        });

        if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

        const { id } = await params;
        const body = await req.json();
        const { status } = body; // "approved" or "rejected"

        if (status !== "approved" && status !== "rejected") {
            return NextResponse.json({ error: "Invalid status" }, { status: 400 });
        }

        const proposal = await prisma.learningProposal.findFirst({
            where: { id, companyId: company.id }
        });

        if (!proposal) {
            return NextResponse.json({ error: "LearningProposal not found" }, { status: 404 });
        }

        if (proposal.status !== "pending") {
            return NextResponse.json({ error: "Only pending proposals can be reviewed" }, { status: 400 });
        }

        const result = await prisma.$transaction(async (tx) => {
            if (status === "rejected") {
                const updated = await tx.learningProposal.update({
                    where: { id },
                    data: {
                        status: "rejected",
                        reviewedAt: new Date(),
                        reviewedBy: userId || "unknown"
                    }
                });
                return { updatedProposal: updated, changeLogId: null };
            }

            // If approved, parse the proposed change
            let change;
            try {
                change = JSON.parse(proposal.proposedChangeJson);
            } catch {
                throw new Error("Invalid proposedChangeJson");
            }

            // Only safety_margin_increase is currently supported
            if (proposal.type !== "safety_margin_increase" || change.field !== "projectionSafetyMargin") {
                throw new Error("Unsupported proposal type");
            }

            const assumption = await tx.assumption.findFirst({
                where: { companyId: company.id }
            });

            if (!assumption) {
                throw new Error("Assumption record not found");
            }

            // Compare expected current value with actual current value (stale check)
            if (assumption.projectionSafetyMargin !== change.currentValue) {
                throw new Error("STALE_ASSUMPTION");
            }

            // Update Assumption
            const updatedAssumption = await tx.assumption.update({
                where: { id: assumption.id },
                data: {
                    projectionSafetyMargin: change.proposedValue
                }
            });

            // Update Proposal
            const updatedProposal = await tx.learningProposal.update({
                where: { id },
                data: {
                    status: "approved",
                    reviewedAt: new Date(),
                    reviewedBy: userId || "unknown"
                }
            });

            // Create ChangeLog
            const changeLog = await tx.changeLog.create({
                data: {
                    companyId: company.id,
                    source: "learning_proposal",
                    action: "UPDATE_ASSUMPTION",
                    inputText: proposal.rationale,
                    diffJson: JSON.stringify({
                        proposalId: id,
                        field: "projectionSafetyMargin",
                        oldValue: change.currentValue,
                        newValue: change.proposedValue
                    }),
                    forecastVersionHashAfter: "pending",
                    userId: userId
                }
            });

            return { updatedProposal, changeLogId: changeLog.id };
        });

        if (result.changeLogId) {
            await resolveForecastHashAfter(company.id, result.changeLogId);
        }

        return NextResponse.json({ success: true, proposal: result.updatedProposal });

    } catch (e: any) {
        console.error("LearningProposal PATCH Error:", e);
        if (e.message === "STALE_ASSUMPTION") {
            return NextResponse.json({ error: "Assumption was modified since this proposal was generated" }, { status: 409 });
        }
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
