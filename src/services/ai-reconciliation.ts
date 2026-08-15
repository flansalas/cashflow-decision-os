import OpenAI from "openai";
import prisma from "@/db/prisma";
import { validateReconciliationLink } from "./reconciliation";
import { v4 as uuidv4 } from "uuid";
import { getManagerialVisibility } from "./managerial-visibility";

let openai: OpenAI | null = null;
try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy-key-for-tests' });
} catch (e) {
    console.warn("OPENAI_API_KEY not set. AI functions will fail gracefully.", e);
}

async function getAvailableAmountSafe(companyId: string, type: string, id: string): Promise<number> {
    try {
        // getAvailableAmount is not exported directly, but we can reconstruct or export it
        // Actually, we can just fetch it directly here since we know the schema.
        if (type === "receivable_invoice") {
            const record = await prisma.receivableInvoice.findUnique({ where: { id, companyId } });
            return record?.amountOpen || 0;
        }
        if (type === "payable_bill") {
            const record = await prisma.payableBill.findUnique({ where: { id, companyId } });
            return record?.amountOpen || 0;
        }
        if (type === "cash_adjustment") {
            const record = await prisma.cashAdjustment.findUnique({ where: { id, companyId } });
            if (!record) return 0;
            
            // Check links
            const activeLinks = await prisma.reconciliationLink.findMany({
                where: { companyId, sourceType: "cash_adjustment", sourceId: id, deductFrom: { not: null } }
            });
            const used = activeLinks.reduce((sum, link) => sum + Number(link.matchedAmount), 0);
            return Math.abs(record.amount) - used;
        }
        if (type === "cash_flow_entry") {
            const record = await prisma.cashFlowEntry.findUnique({ where: { id, companyId } });
            if (!record) return 0;
            
            const activeLinks = await prisma.reconciliationLink.findMany({
                where: { companyId, sourceType: "cash_flow_entry", sourceId: id, deductFrom: { not: null } }
            });
            const used = activeLinks.reduce((sum, link) => sum + Number(link.matchedAmount), 0);
            return record.amount - used;
        }
        return 0;
    } catch (e) {
        return 0;
    }
}

export async function proposeReconciliations(companyId: string) {
    if (!openai) return;

    // 1. Fetch unlinked or partially linked Operational Expectations (CashFlowEntries)
    const entries = await prisma.cashFlowEntry.findMany({
        where: { companyId },
        include: { category: true }
    });

    const activeEntries = [];
    for (const e of entries) {
        const avail = await getAvailableAmountSafe(companyId, "cash_flow_entry", e.id);
        if (avail > 0) activeEntries.push({ ...e, availableAmount: avail });
    }

    if (activeEntries.length === 0) return;

    // 2. Fetch active AR/AP candidates
    const visibility = await getManagerialVisibility(companyId);
    const invoices = await prisma.receivableInvoice.findMany({
        where: { companyId, status: "active", amountOpen: { gt: 0 }, id: { notIn: [...visibility.hiddenInvoiceIds] } }
    });
    
    const bills = await prisma.payableBill.findMany({
        where: { companyId, status: "active", amountOpen: { gt: 0 }, id: { notIn: [...visibility.hiddenBillIds] } }
    });

    // 3. Process each entry
    for (const entry of activeEntries) {
        const isOutflow = entry.category?.direction === "outflow";
        const targetType = isOutflow ? "payable_bill" : "receivable_invoice";
        const candidates = isOutflow ? bills : invoices;

        // Deterministic candidate narrowing
        const viableCandidates = candidates.filter(c => {
            // Must be exact or strongly compatible amount (within 10%)
            const amountMatches = Math.abs(c.amountOpen - entry.availableAmount) / entry.availableAmount <= 0.1;
            
            // Must have compatible date (within 45 days)
            const cDate = (c as any).expectedDate || c.dueDate;
            const eDate = entry.targetDate;
            const daysDiff = Math.abs(new Date(cDate).getTime() - new Date(eDate).getTime()) / (1000 * 60 * 60 * 24);
            const timingMatches = daysDiff <= 45;

            return amountMatches && timingMatches;
        });

        if (viableCandidates.length === 0) continue;

        // Prompt AI for evaluation
        const prompt = `
        Evaluate if this manual operational cash expectation matches any of the following accounting records.
        
        Manual Expectation (Source):
        Label: ${entry.label}
        Amount: ${entry.availableAmount}
        Expected Date: ${entry.targetDate.toISOString().slice(0, 10)}
        Direction: ${isOutflow ? 'Outflow' : 'Inflow'}

        Accounting Candidates (Targets):
        ${viableCandidates.map(c => `
        - ID: ${c.id}
        - Entity: ${(c as any).customerName || (c as any).vendorName || 'Unknown'}
        - Open Amount: ${c.amountOpen}
        - Date: ${((c as any).expectedDate || c.dueDate).toISOString().slice(0, 10)}
        `).join('\n')}

        Return JSON with:
        {
            "matchFound": true/false,
            "targetId": "ID of the best candidate, or null",
            "confidence": "high", "medium", or "low",
            "reasoning": "short explanation",
            "hasStrongIdentityMatch": true/false (true if the entity name is very similar to the source label),
            "preferredTiming": "source" or "target" (which date seems more reliable)
        }
        `;

        try {
            const res = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [{ role: "system", content: "You are a financial reconciliation assistant. Output strict JSON only." }, { role: "user", content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0
            });

            const content = res.choices[0]?.message?.content;
            if (!content) continue;

            const aiEval = JSON.parse(content);
            if (!aiEval.matchFound || !aiEval.targetId || aiEval.confidence === "low") {
                continue; // Ignore low confidence
            }

            const target = viableCandidates.find(c => c.id === aiEval.targetId);
            if (!target) continue;

            // AI may NEVER set economic authority (deductFrom).
            // Human confirmation via the reconciliation UI is the sole path to activate a link.
            // qualifiesForAuto logic has been removed to enforce this invariant.
            const deductFrom = null;

            // Do not create if a link already exists for this pair
            const existingLink = await prisma.reconciliationLink.findFirst({
                where: { companyId, sourceId: entry.id, targetId: target.id }
            });
            
            if (existingLink) continue;

            // Mathematical guardrail: validate before saving
            await validateReconciliationLink(
                companyId,
                "cash_flow_entry",
                entry.id,
                targetType,
                target.id,
                entry.availableAmount
            );

            // Persist the link (always pending — deductFrom=null)
            await prisma.reconciliationLink.create({
                data: {
                    id: uuidv4(),
                    companyId,
                    sourceType: "cash_flow_entry",
                    sourceId: entry.id,
                    targetType,
                    targetId: target.id,
                    matchedAmount: entry.availableAmount,
                    deductFrom,
                    confidence: aiEval.confidence ?? "medium",
                    matchMethod: "ai",
                    explanation: aiEval.reasoning
                }
            });

        } catch (error) {
            console.error("AI Reconciliation error for entry", entry.id, error);
            // Skip and continue to next
        }
    }
}
