import prisma from "@/db/prisma";

export interface ApproveActionItemPayload {
  ownerName: string;
  dueDate: string | Date;
  amountImpact: number;
  constraintWeekStart: string | Date;
  type: string;
  title: string;
  description: string;
  targetType: string;
  targetId: string | null;
  reasoningJson: any;
  priority?: string;
  impactCertainty?: string;
}

export interface ApproveExecutionPlanRequest {
  companyId: string;
  userId: string | null;
  weekStart: string | Date;
  forecastCheckpointId: string;
  expectedCurrentPlanId?: string | null;
  revisionReason?: string | null;
  actions: ApproveActionItemPayload[];
}

export class ApprovalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalConflictError";
  }
}

export class ApprovalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalValidationError";
  }
}

export async function approveExecutionPlan(req: ApproveExecutionPlanRequest) {
  const { companyId, userId, weekStart, forecastCheckpointId, expectedCurrentPlanId, revisionReason, actions } = req;
  const dateWeekStart = new Date(weekStart);

  if (!forecastCheckpointId) {
    throw new ApprovalValidationError("Missing forecastCheckpointId");
  }

  // Validate actions
  for (const a of actions) {
    if (!a.ownerName || !a.dueDate || a.amountImpact == null || !a.constraintWeekStart || !a.type || !a.title || !a.description || !a.targetType || !a.reasoningJson) {
      throw new ApprovalValidationError("Invalid action payload. Missing required fields.");
    }
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Acquire transaction-scoped advisory lock for companyId + weekStart
    // We use hashtext to deterministically map the strings to a 32-bit int, and combine them for the 2-arg advisory lock.
    const weekStr = dateWeekStart.toISOString();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}), hashtext(${weekStr}));`;

    // 2. Read and validate ForecastCheckpoint
    const checkpoint = await tx.forecastCheckpoint.findFirst({
      where: { id: forecastCheckpointId, companyId },
      include: { forecastWeeks: { orderBy: { weekStart: 'asc' } } }
    });

    if (!checkpoint) {
      throw new ApprovalValidationError("Checkpoint not found or belongs to another tenant.");
    }
    if (!checkpoint.sealedAt) {
      throw new ApprovalValidationError("Checkpoint is not sealed.");
    }
    if (
      !checkpoint.forecastVersionHash ||
      !checkpoint.forecastSchemaVersion ||
      !checkpoint.hashAlgorithm ||
      !checkpoint.canonicalPayloadJson ||
      !checkpoint.generatedAt
    ) {
      throw new ApprovalValidationError("Checkpoint is missing canonical identity fields.");
    }
    if (checkpoint.forecastWeeks.length !== 13) {
      throw new ApprovalValidationError(`Checkpoint must have exactly 13 linked weeks. Found ${checkpoint.forecastWeeks.length}.`);
    }
    const w1 = checkpoint.forecastWeeks[0];
    if (w1.weekStart.getTime() !== dateWeekStart.getTime()) {
      throw new ApprovalValidationError("Checkpoint W1 weekStart does not match the requested plan weekStart.");
    }

    // 3. Inspect all current plans for the week
    const allPlansForWeek = await tx.executionPlan.findMany({
      where: { companyId, weekStart: dateWeekStart },
      orderBy: { version: 'desc' },
      include: { forecastCheckpoint: true }
    });

    // 4. Closed/Executed week protection
    const hasExecuted = allPlansForWeek.some(p => p.status === 'executed');
    if (hasExecuted) {
      throw new ApprovalConflictError("Cannot approve a new plan for an already executed week.");
    }

    // 5. Stale-plan validation & legacy duplicate check
    const approvedPlans = allPlansForWeek.filter(p => p.status === 'approved');
    if (approvedPlans.length > 1) {
      throw new ApprovalConflictError("Legacy duplicate approved plans exist for this week. Requires manual disposition.");
    }

    const currentApprovedPlan = approvedPlans.length === 1 ? approvedPlans[0] : null;

    if (!currentApprovedPlan && expectedCurrentPlanId) {
      throw new ApprovalConflictError("Stale browser state: expected an approved plan, but none exists currently.");
    }
    if (currentApprovedPlan) {
      if (currentApprovedPlan.id !== expectedCurrentPlanId) {
        throw new ApprovalConflictError("The approved plan changed since you loaded this page. Reload before approving another revision.");
      }
      if (!revisionReason || revisionReason.trim() === '') {
        throw new ApprovalValidationError("A revisionReason is required when superseding an existing plan.");
      }
    }

    // 6. Calculate next version: MAX(version) + 1
    let maxVersion = 0;
    for (const p of allPlansForWeek) {
      if (p.version > maxVersion) maxVersion = p.version;
    }
    const newVersion = maxVersion + 1;

    // 7. Create the new ExecutionPlan in a transient internal non-approved state
    const draftPlan = await tx.executionPlan.create({
      data: {
        companyId,
        weekStart: dateWeekStart,
        version: newVersion,
        status: "draft_internal",
        forecastCheckpointId,
        forecastStateJson: null, // removing trust in client json
        revisionReason: currentApprovedPlan ? revisionReason : null,
      }
    });

    // 8. Create ActionItems linked to the draft plan
    if (actions.length > 0) {
      await tx.actionItem.createMany({
        data: actions.map(a => ({
          companyId,
          executionPlanId: draftPlan.id,
          ownerName: a.ownerName,
          dueDate: new Date(a.dueDate),
          amountImpact: a.amountImpact,
          constraintWeekStart: new Date(a.constraintWeekStart),
          type: a.type,
          title: a.title,
          description: a.description,
          targetType: a.targetType,
          targetId: a.targetId || null,
          reasoningJson: typeof a.reasoningJson === "string" ? a.reasoningJson : JSON.stringify(a.reasoningJson),
          priority: a.priority || "p2",
          impactCertainty: a.impactCertainty || "med",
          status: "planned"
        }))
      });
    }

    // 9. Supersede the prior approved plan
    if (currentApprovedPlan) {
      await tx.executionPlan.update({
        where: { id: currentApprovedPlan.id },
        data: {
          status: "superseded",
          supersededAt: new Date(),
          supersededByPlanId: draftPlan.id
        }
      });
    }

    // 10. Transition the new plan to approved and set authoritative times
    const now = new Date();
    const approvedPlan = await tx.executionPlan.update({
      where: { id: draftPlan.id },
      data: {
        status: "approved",
        approvedBy: userId,
        approvedAt: now
      },
      include: { actionItems: true }
    });

    // 11. Write ChangeLog in same transaction
    if (currentApprovedPlan) {
      await tx.changeLog.create({
        data: {
          companyId,
          source: "user_ui",
          action: "PLAN_REVISION",
          inputText: revisionReason,
          diffJson: JSON.stringify({ 
            newPlanId: approvedPlan.id,
            newPlanVersion: approvedPlan.version,
            previousPlanId: currentApprovedPlan.id, 
            previousPlanVersion: currentApprovedPlan.version,
            previousForecastCheckpointId: currentApprovedPlan.forecastCheckpointId,
            newForecastCheckpointId: approvedPlan.forecastCheckpointId,
            supersededAt: now.toISOString()
          }),
          forecastVersionHashAfter: checkpoint.forecastVersionHash,
          forecastVersionHashBefore: currentApprovedPlan.forecastCheckpoint?.forecastVersionHash ?? null,
          userId: userId
        }
      });
    } else {
      await tx.changeLog.create({
        data: {
          companyId,
          source: "user_ui",
          action: "INITIAL_PLAN_APPROVAL",
          inputText: "Approved initial weekly execution plan",
          diffJson: JSON.stringify({ 
            planId: approvedPlan.id, 
            planVersion: approvedPlan.version,
            weekStart: approvedPlan.weekStart.toISOString(),
            forecastCheckpointId: approvedPlan.forecastCheckpointId,
            forecastSchemaVersion: checkpoint.forecastSchemaVersion,
            approvedBy: userId,
            approvedAt: now.toISOString()
          }),
          forecastVersionHashAfter: checkpoint.forecastVersionHash,
          forecastVersionHashBefore: null,
          userId: userId
        }
      });
    }

    return approvedPlan;
  });
}
