import prisma from "@/db/prisma";
import { Prisma } from "@prisma/client";

export class ApprovalConflictError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ApprovalConflictError';
    }
}

export class ApprovalValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ApprovalValidationError';
    }
}

interface ActionItemPayload {
    type: string;
    title: string;
    description?: string;
    amountImpact: number;
    constraintWeekStart: string;
    targetType?: string;
    targetId?: string;
    reasoningJson?: any;
    ownerName: string;
    dueDate: string;
}

export interface ApprovePlanOptions {
    companyId: string;
    weekStart: string;
    forecastCheckpointId: string;
    expectedCurrentPlanId?: string | null;
    revisionReason?: string;
    actions: ActionItemPayload[];
    approvedBy?: string;
}

export async function approveExecutionPlan(opts: ApprovePlanOptions) {
    if (!opts.companyId) throw new ApprovalValidationError("Missing companyId");
    if (!opts.weekStart) throw new ApprovalValidationError("Missing weekStart");
    const parsedWeekStart = new Date(opts.weekStart);
    if (isNaN(parsedWeekStart.getTime())) throw new ApprovalValidationError("Invalid weekStart date");
    if (!opts.forecastCheckpointId) throw new ApprovalValidationError("Missing forecastCheckpointId");

    if (!Array.isArray(opts.actions)) throw new ApprovalValidationError("actions must be an array");
    for (const a of opts.actions) {
        if (!a.type || !a.title || !a.ownerName || !a.dueDate) throw new ApprovalValidationError("Action missing required fields");
        const parsedDue = new Date(a.dueDate);
        if (isNaN(parsedDue.getTime())) throw new ApprovalValidationError("Invalid dueDate");
        const parsedConstraint = new Date(a.constraintWeekStart);
        if (isNaN(parsedConstraint.getTime())) throw new ApprovalValidationError("Invalid constraintWeekStart");
        if (typeof a.amountImpact !== 'number' || !isFinite(a.amountImpact)) throw new ApprovalValidationError("Invalid amountImpact");
        try {
            if (a.reasoningJson) JSON.stringify(a.reasoningJson);
        } catch {
            throw new ApprovalValidationError("Invalid reasoningJson");
        }
    }

    const checkpoint = await prisma.forecastCheckpoint.findFirst({
        where: { id: opts.forecastCheckpointId, companyId: opts.companyId, sealedAt: { not: null } }
    });
    if (!checkpoint) {
        throw new ApprovalValidationError("Sealed checkpoint not found or invalid.");
    }

    const exactTimestamp = new Date();

    return await prisma.$transaction(async (tx) => {
        // Advisory lock
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(
            hashtext(${opts.companyId}),
            hashtext(${parsedWeekStart.toISOString()})
        )`;

        const existingPlans = await tx.executionPlan.findMany({
            where: { companyId: opts.companyId, weekStart: parsedWeekStart }
        });

        const currentApproved = existingPlans.filter(p => p.status === 'approved');
        const executedExists = existingPlans.some(p => p.status === 'executed');

        if (executedExists) {
            throw new ApprovalConflictError("Week is already executed.");
        }

        if (currentApproved.length > 1) {
            throw new ApprovalConflictError("Legacy duplicate approved plans exist. Please contact support.");
        }

        const existingApproved = currentApproved[0] || null;

        if (existingApproved) {
            if (existingApproved.id !== opts.expectedCurrentPlanId) {
                throw new ApprovalConflictError("Stale expectedCurrentPlanId. The approved plan was modified by another request.");
            }
            if (!opts.revisionReason) {
                throw new ApprovalValidationError("revisionReason is required when revising an approved plan.");
            }
        }

        const nextVersion = existingPlans.length > 0 ? Math.max(...existingPlans.map(p => p.version)) + 1 : 1;

        if (existingApproved) {
            await tx.executionPlan.update({
                where: { id: existingApproved.id },
                data: {
                    status: 'superseded',
                    supersededAt: exactTimestamp,
                    supersededByPlanId: 'PENDING_NEW_ID'
                }
            });
        }

        // Use transient draft status to construct plan, then update to approved
        const newPlanDraft = await tx.executionPlan.create({
            data: {
                companyId: opts.companyId,
                weekStart: parsedWeekStart,
                version: nextVersion,
                status: 'draft',
                approvedBy: opts.approvedBy || "System",
                approvedAt: exactTimestamp,
                revisionReason: opts.revisionReason,
                forecastCheckpointId: opts.forecastCheckpointId,
                actionItems: {
                    create: opts.actions.map(a => ({
                        companyId: opts.companyId,
                        priority: "medium",
                        impactCertainty: "high",
                        type: a.type,
                        title: a.title,
                        description: a.description || "",
                        amountImpact: a.amountImpact,
                        constraintWeekStart: new Date(a.constraintWeekStart),
                        targetType: a.targetType || "none",
                        targetId: a.targetId || "none",
                        reasoningJson: a.reasoningJson || {},
                        ownerName: a.ownerName,
                        dueDate: new Date(a.dueDate),
                        status: 'pending'
                    }))
                }
            }
        });

        if (existingApproved) {
            await tx.executionPlan.update({
                where: { id: existingApproved.id },
                data: { supersededByPlanId: newPlanDraft.id }
            });
        }

        let newPlan;
        try {
            newPlan = await tx.executionPlan.update({
                where: { id: newPlanDraft.id },
                data: { status: 'approved' }
            });
        } catch (e: any) {
            if (e.code === 'P2002') {
                throw new ApprovalConflictError("Approval uniqueness conflict.");
            }
            throw e;
        }

        await tx.changeLog.create({
            data: {
                companyId: opts.companyId,
                source: 'ExecutionPlan',
                action: existingApproved ? 'REVISED' : 'APPROVED',
                inputText: newPlan.id,
                timestamp: exactTimestamp,
                userId: opts.approvedBy || "System",
                forecastVersionHashAfter: "approved",
                diffJson: JSON.stringify({
                    supersededPlanId: existingApproved?.id,
                    newPlanId: newPlan.id,
                    version: newPlan.version,
                    forecastCheckpointId: opts.forecastCheckpointId
                })
            }
        });

        return newPlan;
    });
}
