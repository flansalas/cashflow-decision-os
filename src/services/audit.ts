import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

export type AuditEventSource = "user" | "system" | "bank_sync" | "bookkeeper";

/**
 * Standardized audit event structure.
 * All forecast-changing actions must log with this shape to ensure:
 * - Consistent audit trail
 * - Post-approval change summaries
 * - Weekly Review diff capability
 * - Forecast hash traceability
 *
 * diffJson will always contain:
 *   { targetId, targetType, entityType, entityId, fieldChanged,
 *     oldValue, newValue, reasoning, reason, approvedPlanVersion, source }
 */
export interface LogEventParams {
    companyId: string;
    targetId: string;
    targetType: "invoice" | "bill" | "assumption" | "bank_balance" | "forecast_week" | "recurring_pattern";
    action: string;
    source: AuditEventSource;

    // Diff representation
    fieldChanged: string;
    oldValue: string | number | null;
    newValue: string | number | null;

    // Context
    reasoning?: string | null;

    // Optional: user-provided reason for the override (distinct from system reasoning)
    reason?: string | null;

    // Approved plan version at the time of the event (for post-approval change tracking)
    approvedPlanVersion?: number | null;

    // Forecast hashes for before/after comparison
    forecastVersionHashBefore?: string | null;
    forecastVersionHashAfter?: string;

    // Authenticated user ID (if available)
    userId?: string | null;

    overrideId?: string | null;
}

/**
 * Audit Logging Service
 * Wraps the existing ChangeLog model but enforces a structured diff format
 * that the TransactionHistoryTimeline can parse.
 *
 * One user action must produce exactly one ChangeLog entry.
 * Do not call this more than once per user action.
 */
export async function logAuditEvent(params: LogEventParams) {
    // The diffJson always contains all structured fields for backward and forward readability
    const diffJson = JSON.stringify({
        // Entity identification
        targetId: params.targetId,
        targetType: params.targetType,
        entityType: params.targetType,
        entityId: params.targetId,

        // Diff
        fieldChanged: params.fieldChanged,
        oldValue: params.oldValue,
        newValue: params.newValue,

        // Reason/context (two distinct fields)
        reasoning: params.reasoning ?? null,   // system-derived reasoning
        reason: params.reason ?? null,          // user-supplied reason

        // Plan context
        approvedPlanVersion: params.approvedPlanVersion ?? null,

        // Source
        source: params.source,
        userId: params.userId ?? null,
        overrideId: params.overrideId ?? null,
    });

    const oldStr = params.oldValue !== null && params.oldValue !== undefined ? String(params.oldValue) : "None";
    const newStr = params.newValue !== null && params.newValue !== undefined ? String(params.newValue) : "None";
    const reasonSuffix = params.reason ? ` (Reason: ${params.reason})` : "";
    const inputText = `Changed ${params.fieldChanged} from ${oldStr} to ${newStr}${reasonSuffix}`;

    return prisma.changeLog.create({
        data: {
            id: uuidv4(),
            companyId: params.companyId,
            timestamp: new Date(),
            source: params.source === "user" ? "user_ui" : params.source,
            action: params.action,
            inputText,
            diffJson,
            forecastVersionHashBefore: params.forecastVersionHashBefore ?? null,
            forecastVersionHashAfter: params.forecastVersionHashAfter ?? "pending",
            userId: params.userId ?? null,
        }
    });
}
