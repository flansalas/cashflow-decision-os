import prisma from "@/db/prisma";
import { Prisma } from "@prisma/client";

export async function snapshotAccountFreshness(checkpointId: string, companyId: string, tx: Prisma.TransactionClient = prisma) {
    // Determine the latest transaction per bank account
    const accounts = await tx.bankAccount.findMany({
        where: { companyId },
        include: {
            transactions: {
                orderBy: { txDate: "desc" },
                take: 1
            }
        }
    });

    const freshnessRecords = accounts.map(acc => {
        const latestTx = acc.transactions[0];
        
        // Default to unverified without using a placeholder or recency heuristic.
        // Will be updated if explicit evidence (Plaid sync success or manual manifest) is found.
        let coverageStatus = "unverified";
        let completenessEvidence: string | null = null;
        
        // If we had Plaid integration or manual manifest check, it would go here:
        // if (acc.lastSyncSuccess === true && acc.lastSyncDate >= requiredDate) {
        //     coverageStatus = "complete";
        //     completenessEvidence = "plaid_sync_success";
        // }

        return {
            id: require("crypto").randomUUID(),
            checkpointId,
            accountId: acc.id,
            sourceType: "system", // Or Plaid if integrated
            latestTransactionDate: latestTx ? latestTx.txDate : null,
            ingestionTimestamp: new Date(),
            coverageStatus,
            completenessEvidence,
        };
    });

    if (freshnessRecords.length > 0) {
        await tx.accountFreshnessStatus.createMany({
            data: freshnessRecords,
            skipDuplicates: true
        });
    }

    console.log(`[Attribution Checkpoint] Recorded freshness for ${freshnessRecords.length} accounts on Checkpoint ${checkpointId}`);
}

export interface AttributionAllocationInput {
    bankTransactionId: string;
    componentCategory?: string;
    sourceType: string;
    targetWeekStart: Date;
    maturedForecastWeek: Date;
    amountAttributed: number;
    direction: string;
    confidenceTier: "high" | "med" | "low";
    attributionMethod: string;
}

export async function saveAttributionAllocations(
    companyId: string,
    checkpointId: string,
    allocations: AttributionAllocationInput[],
    tx: Prisma.TransactionClient = prisma
) {
    const versionStr = `v-${Date.now()}`;
    
    // Group allocations by transaction to enforce total doesn't exceed transaction amount
    const txGroups = new Map<string, AttributionAllocationInput[]>();
    for (const alloc of allocations) {
        if (!txGroups.has(alloc.bankTransactionId)) txGroups.set(alloc.bankTransactionId, []);
        txGroups.get(alloc.bankTransactionId)!.push(alloc);
    }

    const txIds = Array.from(txGroups.keys());
    const transactions = await tx.bankTransaction.findMany({
        where: { id: { in: txIds }, companyId }
    });

    const txMap = new Map(transactions.map(t => [t.id, t]));

    const validAllocationsToCreate: any[] = [];

    for (const [txId, group] of txGroups.entries()) {
        const tx = txMap.get(txId);
        if (!tx) continue;

        let totalConfirmed = 0;
        
        for (const alloc of group) {
            // Only confirmed allocations count toward the strict limit
            if (alloc.confidenceTier === "high") {
                totalConfirmed += alloc.amountAttributed;
            }
            
            validAllocationsToCreate.push({
                companyId,
                checkpointId,
                bankTransactionId: txId,
                componentCategory: alloc.componentCategory || "unresolved_outflow",
                sourceType: alloc.sourceType || "unresolved",
                targetWeekStart: alloc.targetWeekStart,
                maturedForecastWeek: alloc.maturedForecastWeek,
                amountAttributed: alloc.amountAttributed,
                direction: alloc.direction,
                confidenceTier: alloc.confidenceTier,
                attributionMethod: alloc.attributionMethod,
                attributionRunId: versionStr,
                isActive: true
            });
        }

        if (totalConfirmed > Math.abs(tx.amount)) {
            throw new Error(`Total confirmed allocations (${totalConfirmed}) exceed transaction amount (${Math.abs(tx.amount)}) for tx ${txId}`);
        }
    }

    // Deactivate previous active allocations for these transactions
    if (txIds.length > 0) {
        await tx.actualCashAttribution.updateMany({
            where: {
                bankTransactionId: { in: txIds },
                checkpointId, // Deactivate only for this specific checkpoint context
                isActive: true
            },
            data: { isActive: false }
        });
    }

    // Insert new allocations
    if (validAllocationsToCreate.length > 0) {
        await tx.actualCashAttribution.createMany({
            data: validAllocationsToCreate
        });
    }

    return validAllocationsToCreate.length;
}
