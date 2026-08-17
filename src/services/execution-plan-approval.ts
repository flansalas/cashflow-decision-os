import prisma from "@/db/prisma";
import { Prisma } from "@prisma/client";
import { evaluateCompanyDataReadiness } from "./data-readiness-evaluation";
import { assertCertifiedDecisionIntegrity } from "./forecast-certification";
import {
    computeCanonicalHash,
    FORECAST_SCHEMA_VERSION,
    HASH_ALGORITHM
} from "./canonical-hash";

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
    reasoningJson?: unknown;
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

    const exactTimestamp = new Date();

    return await prisma.$transaction(async (tx) => {
        // Advisory lock
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(
            hashtext(${opts.companyId}),
            hashtext(${parsedWeekStart.toISOString()})
        )`;

        const checkpoint = await tx.forecastCheckpoint.findFirst({
            where: { id: opts.forecastCheckpointId, companyId: opts.companyId },
            include: {
                forecastWeeks: {
                    orderBy: { weekStart: 'asc' }
                }
            }
        });

        if (!checkpoint || checkpoint.companyId !== opts.companyId) {
            throw new ApprovalValidationError("Checkpoint not found or belongs to another company");
        }
        if (!checkpoint.sealedAt) throw new ApprovalValidationError("Checkpoint is not sealed");
        if (!checkpoint.generatedAt) throw new ApprovalValidationError("Checkpoint is missing generatedAt");
        if (!checkpoint.forecastVersionHash) throw new ApprovalValidationError("Checkpoint is missing forecastVersionHash");
        if (!checkpoint.canonicalPayloadJson) throw new ApprovalValidationError("Checkpoint is missing canonicalPayloadJson");
        if (!checkpoint.forecastSchemaVersion) throw new ApprovalValidationError("Checkpoint is missing forecastSchemaVersion");
        if (!checkpoint.hashAlgorithm) throw new ApprovalValidationError("Checkpoint is missing hashAlgorithm");
        if (checkpoint.forecastSchemaVersion !== FORECAST_SCHEMA_VERSION) {
            throw new ApprovalValidationError("Checkpoint forecastSchemaVersion is unsupported");
        }
        if (checkpoint.hashAlgorithm !== HASH_ALGORITHM) {
            throw new ApprovalValidationError("Checkpoint hashAlgorithm is unsupported");
        }
        try {
            JSON.parse(checkpoint.canonicalPayloadJson);
        } catch {
            throw new ApprovalValidationError("Checkpoint canonicalPayloadJson is malformed");
        }
        if (computeCanonicalHash(checkpoint.canonicalPayloadJson) !== checkpoint.forecastVersionHash) {
            throw new ApprovalValidationError("Checkpoint canonicalPayloadJson does not match forecastVersionHash");
        }

        const weeks = checkpoint.forecastWeeks || [];
        if (weeks.length !== 13) throw new ApprovalValidationError(`Checkpoint has ${weeks.length} weeks instead of exactly 13`);

        // Check contiguous ordering and first week
        if (weeks[0].weekStart.getTime() !== parsedWeekStart.getTime()) {
            throw new ApprovalValidationError("First week of checkpoint does not match the requested plan weekStart");
        }
        for (let i = 1; i < weeks.length; i++) {
            const expectedNext = new Date(weeks[i-1].weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
            if (weeks[i].weekStart.getTime() !== expectedNext.getTime()) {
                throw new ApprovalValidationError("Checkpoint weeks are not strictly contiguous by 7 days");
            }
        }


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

        const evalResult = await evaluateCompanyDataReadiness(
            opts.companyId,
            exactTimestamp,
            checkpoint.cashSnapshotId,
            checkpoint.id,
            tx
        );
        if (evalResult.status !== 'decision_ready') {
            throw new ApprovalValidationError(`Cannot approve plan: Company data is not decision-ready (Status: ${evalResult.status})`);
        }

        const governingCert = await tx.forecastVersionCertification.findFirst({
            where: {
                companyId: opts.companyId,
                forecastCheckpointId: opts.forecastCheckpointId
            },
            orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
            include: { downsideScenario: true }
        });

        if (!governingCert) {
            throw new ApprovalValidationError("Cannot approve plan: A finalized Forecast-Version Certification is absent for this checkpoint.");
        }
        if (governingCert.status !== 'certified') {
            throw new ApprovalValidationError(
                `Cannot approve plan: Latest governing Forecast-Version Certification is ${governingCert.status}, not certified.`
            );
        }
        try {
            assertCertifiedDecisionIntegrity(governingCert, {
                id: checkpoint.id,
                companyId: checkpoint.companyId,
                forecastVersionHash: checkpoint.forecastVersionHash,
                cashSnapshotId: checkpoint.cashSnapshotId,
                forecastWeeks: checkpoint.forecastWeeks
            });
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown integrity error";
            throw new ApprovalValidationError(`Cannot approve plan: ${message}`);
        }

        // 7. READINESS EVIDENCE BINDING
        if (governingCert.readinessEvidenceHash !== evalResult.evidenceHash) {
            throw new ApprovalValidationError("Cannot approve plan: Stale certification. The readiness evidence hash has changed since the certification was made.");
        }
        if (governingCert.forecastVersionHash !== checkpoint.forecastVersionHash) {
            throw new ApprovalValidationError("Cannot approve plan: Stale certification. The forecastVersionHash has changed.");
        }
        if (governingCert.cashSnapshotId !== checkpoint.cashSnapshotId) {
            throw new ApprovalValidationError("Cannot approve plan: Stale certification. The cashSnapshotId has changed.");
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

        // Removed initial update using 'PENDING_NEW_ID'

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
                        reasoningJson: typeof a.reasoningJson === "string"
                            ? a.reasoningJson
                            : JSON.stringify(a.reasoningJson ?? {}),
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
                data: {
                    status: 'superseded',
                    supersededAt: exactTimestamp,
                    supersededByPlanId: newPlanDraft.id
                }
            });
        }

        let newPlan;
        try {
            newPlan = await tx.executionPlan.update({
                where: { id: newPlanDraft.id },
                data: { status: 'approved' }
            });
        } catch (error: unknown) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
                throw new ApprovalConflictError("Approval uniqueness conflict.");
            }
            throw error;
        }

        // Fetch existing approved's checkpoint for lineage if it exists
        let forecastVersionHashBefore = null;
        if (existingApproved?.forecastCheckpointId) {
            const oldCheckpoint = await tx.forecastCheckpoint.findUnique({
                where: { id: existingApproved.forecastCheckpointId },
                select: { forecastVersionHash: true }
            });
            if (oldCheckpoint?.forecastVersionHash) {
                forecastVersionHashBefore = oldCheckpoint.forecastVersionHash;
            }
        }

        await tx.changeLog.create({
            data: {
                companyId: opts.companyId,
                source: 'ExecutionPlan',
                action: existingApproved ? 'REVISED' : 'APPROVED',
                inputText: newPlan.id,
                timestamp: exactTimestamp,
                userId: opts.approvedBy || "System",
                forecastVersionHashBefore: forecastVersionHashBefore,
                forecastVersionHashAfter: checkpoint.forecastVersionHash,
                diffJson: JSON.stringify({
                    supersededPlanId: existingApproved?.id,
                    newPlanId: newPlan.id,
                    version: newPlan.version,
                    forecastCheckpointId: opts.forecastCheckpointId
                })
            }
        });

        return newPlan;
    }, {
        maxWait: 10_000,
        timeout: 60_000
    });
}
