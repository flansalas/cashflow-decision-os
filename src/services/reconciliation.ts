import { PrismaClient } from "@prisma/client";
import prisma from "@/db/prisma";

/**
 * Validates whether a proposed reconciliation link over-allocates either the source or target.
 * Throws an error if validation fails.
 */
export async function validateReconciliationLink(
    companyId: string,
    sourceType: string,
    sourceId: string,
    targetType: string,
    targetId: string,
    proposedAmount: number,
    existingLinkId?: string
) {
    if (proposedAmount <= 0) {
        throw new Error("Proposed matched amount must be strictly positive");
    }

    // 1. Fetch current available amounts for source and target
    const [sourceAvailable, targetAvailable] = await Promise.all([
        getAvailableAmount(companyId, sourceType, sourceId),
        getAvailableAmount(companyId, targetType, targetId)
    ]);

    // 2. Fetch active links for source to calculate current usage
    const activeSourceLinks = await prisma.reconciliationLink.findMany({
        where: {
            companyId,
            status: "active",
            sourceId,
            sourceType,
            ...(existingLinkId ? { id: { not: existingLinkId } } : {})
        }
    });
    // Note: since it's many-to-many, source could technically be a target in another link, 
    // but the system is designed to use consistent sourceType/sourceId. We should check both sides just in case.
    const activeSourceAsTargetLinks = await prisma.reconciliationLink.findMany({
        where: {
            companyId,
            status: "active",
            targetId: sourceId,
            targetType: sourceType,
            ...(existingLinkId ? { id: { not: existingLinkId } } : {})
        }
    });
    
    const sourceUsed = 
        activeSourceLinks.reduce((sum, link) => sum + Number(link.matchedAmount), 0) +
        activeSourceAsTargetLinks.reduce((sum, link) => sum + Number(link.matchedAmount), 0);
        
    if (sourceUsed + proposedAmount > sourceAvailable) {
        throw new Error(`Over-allocation: Proposed amount ${proposedAmount} plus existing ${sourceUsed} exceeds source available ${sourceAvailable}`);
    }

    // 3. Fetch active links for target to calculate current usage
    const activeTargetLinks = await prisma.reconciliationLink.findMany({
        where: {
            companyId,
            status: "active",
            targetId,
            targetType,
            ...(existingLinkId ? { id: { not: existingLinkId } } : {})
        }
    });
    
    const activeTargetAsSourceLinks = await prisma.reconciliationLink.findMany({
        where: {
            companyId,
            status: "active",
            sourceId: targetId,
            sourceType: targetType,
            ...(existingLinkId ? { id: { not: existingLinkId } } : {})
        }
    });
    
    const targetUsed = 
        activeTargetLinks.reduce((sum, link) => sum + Number(link.matchedAmount), 0) +
        activeTargetAsSourceLinks.reduce((sum, link) => sum + Number(link.matchedAmount), 0);

    if (targetUsed + proposedAmount > targetAvailable) {
        throw new Error(`Over-allocation: Proposed amount ${proposedAmount} plus existing ${targetUsed} exceeds target available ${targetAvailable}`);
    }
}

async function getAvailableAmount(companyId: string, type: string, id: string): Promise<number> {
    if (type === "receivable_invoice") {
        const record = await prisma.receivableInvoice.findUnique({ where: { id, companyId } });
        if (!record) throw new Error(`Receivable invoice ${id} not found`);
        return record.amountOpen;
    }
    if (type === "payable_bill") {
        const record = await prisma.payableBill.findUnique({ where: { id, companyId } });
        if (!record) throw new Error(`Payable bill ${id} not found`);
        return record.amountOpen;
    }
    if (type === "cash_adjustment") {
        const record = await prisma.cashAdjustment.findUnique({ where: { id, companyId } });
        if (!record) throw new Error(`Cash adjustment ${id} not found`);
        return Math.abs(record.amount);
    }
    if (type === "cash_flow_entry") {
        const record = await prisma.cashFlowEntry.findUnique({ where: { id, companyId } });
        if (!record) throw new Error(`Cash flow entry ${id} not found`);
        return record.amount;
    }
    throw new Error(`Unsupported reconciliation source type: ${type}`);
}
