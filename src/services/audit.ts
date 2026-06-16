import prisma from "@/db/prisma";
import { v4 as uuidv4 } from "uuid";

export type AuditEventSource = "user" | "system" | "bank_sync" | "bookkeeper";

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
    forecastVersionHashAfter?: string;
}

/**
 * Audit Logging Service
 * Wraps the existing ChangeLog model but enforces a structured diff format
 * that the TransactionHistoryTimeline can parse.
 */
export async function logAuditEvent(params: LogEventParams) {
    // The diffJson should contain the structured event data
    const diffJson = JSON.stringify({
        targetId: params.targetId,
        targetType: params.targetType,
        fieldChanged: params.fieldChanged,
        oldValue: params.oldValue,
        newValue: params.newValue,
        reasoning: params.reasoning ?? null
    });

    // Provide a human-readable summary for inputText (for the global audit log)
    const oldStr = params.oldValue !== null ? String(params.oldValue) : "None";
    const newStr = params.newValue !== null ? String(params.newValue) : "None";
    const inputText = `Changed ${params.fieldChanged} from ${oldStr} to ${newStr}`;

    return prisma.changeLog.create({
        data: {
            id: uuidv4(),
            companyId: params.companyId,
            timestamp: new Date(),
            source: params.source === "user" ? "user_ui" : params.source, // Mapping to existing ChangeLog schema expected values
            action: params.action,
            inputText: inputText,
            diffJson: diffJson,
            forecastVersionHashAfter: params.forecastVersionHashAfter ?? "pending",
        }
    });
}
