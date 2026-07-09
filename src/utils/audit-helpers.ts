import { ChangeLog } from "@prisma/client";

/**
 * Get the canonical user ID from a ChangeLog event.
 * Falls back to the diffJson payload for backward compatibility with older events.
 */
export function getAuditIdentity(log: ChangeLog): string | null {
    if (log.userId) return log.userId;
    try {
        const payload = JSON.parse(log.diffJson);
        return payload.userId || null;
    } catch {
        return null;
    }
}

/**
 * Get the user-provided reason from a ChangeLog event.
 */
export function getAuditReason(log: ChangeLog): string | null {
    try {
        const payload = JSON.parse(log.diffJson);
        return payload.reason || null;
    } catch {
        return null;
    }
}
