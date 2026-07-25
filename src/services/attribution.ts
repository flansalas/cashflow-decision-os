import { prisma } from "@/db/prisma";
import crypto from "crypto";
import { getMonday } from "./forecast";
import { isRecurringIdentityMatch } from "./detectPatterns";

export interface AttributionTarget {
    transactionId: string;
    amount: number;
    direction: "inflow" | "outflow";
}

/**
 * Deterministic service to attribute bank transactions to economic components.
 * 
 * Rules:
 * - Idempotent: deletes any non-user-verified attributions for the given transactions before re-running.
 * - Integer-cent math: avoids floating point drift.
 * - Partial attribution: unmatched remainder explicitly preserved as unresolved.
 */
export async function runAttributionForWeek(
    companyId: string, 
    weekStart: Date, 
    weekEnd: Date, 
    runId?: string
) {
    const attributionRunId = runId || crypto.randomUUID();

    // 1. Fetch bank transactions for the week
    const transactions = await prisma.bankTransaction.findMany({
        where: {
            companyId,
            txDate: {
                gte: weekStart,
                lte: weekEnd
            }
        },
        include: {
            attributions: true
        }
    });

    if (transactions.length === 0) {
        return { ok: true, message: "No transactions to attribute", runId: attributionRunId };
    }

    const transactionIds = transactions.map(t => t.id);

    // Idempotency: Preserve history of unverified attributions before clearing them
    // Non-destructive attribution: Mark non-user-verified attributions for these transactions as inactive
    // so we can re-evaluate them without destroying historical evaluation evidence.
    await prisma.actualCashAttribution.updateMany({
        where: {
            bankTransactionId: { in: transactionIds },
            confidenceTier: { not: "high" }, // don't touch explicit user links
            isActive: true
        },
        data: {
            isActive: false
        }
    });

    const oldAttributions = await prisma.actualCashAttribution.findMany({
        where: {
            companyId,
            bankTransactionId: { in: transactionIds },
            isUserVerified: false
        }
    });

    if (oldAttributions.length > 0) {
        await prisma.changeLog.create({
            data: {
                companyId,
                action: "ATTRIBUTION_REPLACED",
                source: "system",
                inputText: `Replaced ${oldAttributions.length} unverified attributions during run ${attributionRunId}`,
                diffJson: JSON.stringify({ previousAttributions: oldAttributions }),
                forecastVersionHashAfter: "attribution_pass"
            }
        });

        // Removed deleteMany to preserve historical evidence.
        // The earlier updateMany(isActive: false) successfully clears the active path without destroying evidence.
    }

    // We will build new attributions here
    const newAttributions = [];

    // Also fetch context for deterministic matching (Pass 1 and 2)
    const activeRecurringPatterns = await prisma.recurringPattern.findMany({
        where: { companyId, status: "active", isIncluded: true }
    });

    // Fetch invoices that have linked bank transactions through CashFlowEntry -> matching logic?
    // Wait, in Slice 2, we just look for exact links. If the UI previously mapped a transaction to an invoice, where is it?
    // Let's check how UI matches invoices... It updates the ReceivableInvoice to "paid". But does it link the transaction?
    // Actually, we can use the transaction description or amount bounds for basic matching, or if we have explicit links (not yet modeled deeply outside of maybe StagedImportRow).
    // The prompt: "support confirmed AR/AP matches; support cautious recurring matches; preserve unresolved amounts explicitly"
    
    // Pass 1: AR/AP Matches (Basic example logic for cautious deterministic matching based on exact amount and recent date)
    // For simplicity, we just stub this cautious matching. The exact AR/AP matching engine is complex.
    const openInvoices = await prisma.receivableInvoice.findMany({
        where: { companyId, status: "open" }
    });

    const openBills = await prisma.payableBill.findMany({
        where: { companyId, status: "open" }
    });

    for (const tx of transactions) {
        let remainingCents = Math.round(Math.abs(tx.amount) * 100);
        let currentPass = 1;

        // Skip fully verified amounts
        const verifiedAttributions = tx.attributions.filter(a => a.isUserVerified);
        for (const va of verifiedAttributions) {
            remainingCents -= Math.round(Math.abs(va.amountAttributed) * 100);
        }

        if (remainingCents <= 0) continue;

        // Pass 1: Confirmed or Explicitly Linked AR/AP Match
        // We require strict evidence such as an invoice reference in the bank transaction description.
        // We no longer greedily infer purely by amount.
        if (tx.direction === "inflow") {
            const matchingInvoices = openInvoices
                .filter(inv => 
                    Math.round(inv.amountOpen * 100) <= remainingCents &&
                    tx.description.toLowerCase().includes(inv.invoiceNo.toLowerCase())
                )
                .sort((a, b) => b.amountOpen - a.amountOpen);
                
            for (const invoice of matchingInvoices) {
                const invoiceCents = Math.round(invoice.amountOpen * 100);
                if (remainingCents >= invoiceCents) {
                    newAttributions.push({
                        companyId,
                        bankTransactionId: tx.id,
                        targetWeekStart: getMonday(tx.txDate),
                        direction: "inflow",
                        componentCategory: "scheduled_ar",
                        sourceType: "receivable_invoice",
                        sourceId: invoice.id,
                        amountAttributed: invoice.amountOpen,
                        confidenceTier: "med",
                        attributionRunId
                    });
                    remainingCents -= invoiceCents;
                }
            }
        } else if (tx.direction === "outflow") {
            const matchingBills = openBills
                .filter(bill => 
                    Math.round(bill.amountOpen * 100) <= remainingCents &&
                    tx.description.toLowerCase().includes(bill.billNo.toLowerCase())
                )
                .sort((a, b) => b.amountOpen - a.amountOpen);
                
            for (const bill of matchingBills) {
                const billCents = Math.round(bill.amountOpen * 100);
                if (remainingCents >= billCents) {
                    newAttributions.push({
                        companyId,
                        bankTransactionId: tx.id,
                        targetWeekStart: getMonday(tx.txDate),
                        direction: "outflow",
                        componentCategory: "scheduled_ap",
                        sourceType: "payable_bill",
                        sourceId: bill.id,
                        amountAttributed: bill.amountOpen,
                        confidenceTier: "med",
                        attributionRunId
                    });
                    remainingCents -= billCents;
                }
            }
        }

        if (remainingCents <= 0) continue;

        // Pass 2: Strict Recurring Identity Matches
        const relevantPatterns = activeRecurringPatterns.filter(p => p.direction === tx.direction);
        for (const pattern of relevantPatterns) {
            const isMatch = isRecurringIdentityMatch(
                { description: tx.description, direction: tx.direction, amount: remainingCents / 100, txDate: tx.txDate },
                {
                    merchantKey: pattern.merchantKey || pattern.displayName,
                    displayName: pattern.displayName,
                    direction: pattern.direction,
                    typicalAmount: pattern.typicalAmount,
                    amountStdDev: pattern.amountStdDev
                },
                null, // No lastMatchedDate trackable in this stateless pass easily, identity is the main constraint
                pattern.cadence
            );

            if (isMatch) {
                const attributedAmount = remainingCents / 100; // Attribute the remainder to this pattern
                newAttributions.push({
                    companyId,
                    bankTransactionId: tx.id,
                    targetWeekStart: getMonday(tx.txDate),
                    direction: tx.direction,
                    componentCategory: "recurring",
                    sourceType: "recurring_pattern",
                    sourceId: pattern.id,
                    amountAttributed: attributedAmount,
                    confidenceTier: "med",
                    attributionRunId
                });
                remainingCents -= Math.round(attributedAmount * 100);
                break; // Stop matching this transaction once attributed
            }
        }

        if (remainingCents <= 0) continue;

        // Pass 3: Unresolved Remainder
        if (remainingCents > 0) {
            const unresolvedAmount = remainingCents / 100;
            newAttributions.push({
                companyId,
                bankTransactionId: tx.id,
                targetWeekStart: getMonday(tx.txDate),
                direction: tx.direction,
                componentCategory: tx.direction === "inflow" ? "unresolved_inflow" : "unresolved_outflow",
                sourceType: "unresolved",
                sourceId: null,
                amountAttributed: unresolvedAmount,
                confidenceTier: "low",
                attributionRunId
            });
            remainingCents = 0;
        }
    }

    if (newAttributions.length > 0) {
        await prisma.actualCashAttribution.createMany({
            data: newAttributions
        });
    }

    return {
        ok: true,
        runId: attributionRunId,
        attributedTransactions: transactionIds.length,
        newRecordsCreated: newAttributions.length
    };
}
