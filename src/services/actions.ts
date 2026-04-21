// services/actions.ts – Rules-based action engine
// Pure logic. No React, no DB imports.

import type { ImpactCertainty, ActionPriority, BusinessCashState, SimulationDelta } from "@/domain/types";
import type { ForecastResult, ForecastInvoice, ForecastBill, ForecastInput } from "./forecast";
import { computeForecast } from "./forecast";

export interface GeneratedAction {
    type: "collect_ar" | "delay_ap" | "reduce_outflows" | "add_cash_adjustment" | "other" | "risk_alert";
    priority: ActionPriority;
    title: string;
    description: string;
    amountImpact: number;
    impactCertainty: ImpactCertainty;
    constraintWeekStart: string | null;
    targetType: string;
    targetId: string | null;
    reasoningJson: string;
    simulationDelta?: SimulationDelta;
}

export interface ActionInput {
    forecast: ForecastResult;
    invoices: ForecastInvoice[];
    bills: ForecastBill[];
    bufferMin: number;
    rawForecastInput?: ForecastInput;
}

export function generateActions(input: ActionInput): GeneratedAction[] {
    const { forecast, invoices, bills, bufferMin } = input;
    const actions: GeneratedAction[] = [];

    const constraintWeek = forecast.constraintWeek;
    const worstConstraintWeek = forecast.worstCaseConstraintWeek;
    const expectedRunOut = forecast.expectedRunOutWeek;
    const worstRunOut = forecast.worstCaseRunOutWeek;

    // Calculate gap
    const gapExpected = constraintWeek
        ? bufferMin - (forecast.weeks[constraintWeek - 1]?.endCashExpected ?? 0)
        : 0;
    const gapWorst = worstConstraintWeek
        ? -(forecast.weeks[worstConstraintWeek - 1]?.endCashWorst ?? 0)
        : 0;

    const constraintWeekStr = constraintWeek
        ? forecast.weeks[constraintWeek - 1]?.weekStart.toISOString().slice(0, 10) ?? null
        : null;

    // ── Risk Alert (when worst-case earlier than expected) ────────────
    if (worstRunOut != null && (expectedRunOut == null || worstRunOut < expectedRunOut)) {
        actions.push({
            type: "risk_alert",
            priority: "p1",
            title: `Worst-case cash exhaustion at Week ${worstRunOut}`,
            description: `Expected runway ${expectedRunOut ? `Week ${expectedRunOut}` : "is safe"}, but worst-case scenario shows cash running out at Week ${worstRunOut}. Gap: $${Math.abs(gapWorst).toLocaleString()}.`,
            amountImpact: Math.abs(gapWorst),
            impactCertainty: "low",
            constraintWeekStart: constraintWeekStr,
            targetType: "assumption",
            targetId: null,
            reasoningJson: JSON.stringify({
                constraintWeekStart: constraintWeekStr,
                gapAmountExpected: gapExpected,
                gapAmountWorst: gapWorst,
                selectedTargets: [],
                impactAmount: Math.abs(gapWorst),
                impactCertainty: "low",
            }),
        });
    }

    // ── Collect AR actions (certainty-first & discount strategies) ────
    const openInvoices = invoices
        .filter(i => i.status === "open" && !i.markedPaid && i.amountOpen > 0)
        .filter(i => {
            // Avoid disputed / retainage
            if (i.metaJson) {
                try {
                    const meta = JSON.parse(i.metaJson);
                    if (meta.disputed || meta.retainage) return false;
                } catch { /* ignore */ }
            }
            return true;
        })
        .map(inv => {
            // Determine certainty
            let certainty: ImpactCertainty = "high";
            if (inv.riskTag === "high" || (inv.daysPastDue ?? 0) > 60) certainty = "low";
            else if (inv.riskTag === "med" || (inv.daysPastDue ?? 0) > 14) certainty = "med";

            return { inv, certainty };
        })
        // Sort by certainty (high first), then amount (desc)
        .sort((a, b) => {
            const certOrder: Record<ImpactCertainty, number> = { high: 0, med: 1, low: 2 };
            if (certOrder[a.certainty] !== certOrder[b.certainty]) {
                return certOrder[a.certainty] - certOrder[b.certainty];
            }
            return b.inv.amountOpen - a.inv.amountOpen;
        });

    for (const { inv, certainty } of openInvoices.slice(0, 5)) {
        // High-certainty current invoices are ideal candidates for an early payment discount
        const isCurrent = (inv.daysPastDue ?? 0) <= 0;
        const offerDiscount = isCurrent && certainty === "high" && gapExpected > 0;
        
        actions.push({
            type: "collect_ar",
            priority: certainty === "high" ? "p1" : certainty === "med" ? "p2" : "p3",
            title: offerDiscount 
                ? `Offer 2% discount to ${inv.customerName}`
                : `Collect $${inv.amountOpen.toLocaleString()} from ${inv.customerName}`,
            description: offerDiscount
                ? `Offer a discount on invoice ${inv.invoiceNo} for immediate payment. Pulls forward ~$${inv.amountOpen.toLocaleString()} into Week 1.`
                : `Invoice ${inv.invoiceNo} — ${(inv.daysPastDue ?? 0) > 0 ? `${inv.daysPastDue} days overdue` : "current"}. ${constraintWeek ? `Closes ~$${inv.amountOpen.toLocaleString()} of gap in Week ${constraintWeek}.` : ""}`,
            amountImpact: inv.amountOpen,
            impactCertainty: certainty,
            constraintWeekStart: constraintWeekStr,
            targetType: "invoice",
            targetId: inv.id,
            reasoningJson: JSON.stringify({
                constraintWeekStart: constraintWeekStr,
                gapAmountExpected: gapExpected,
                gapAmountWorst: gapWorst,
                selectedTargets: [inv.id],
                impactAmount: inv.amountOpen,
                impactCertainty: certainty,
                strategy: offerDiscount ? "early_payment_discount" : "standard_collection",
            }),
        });
    }

    // ── Delay AP actions (partial payments & distribution) ────────────
    const delayableBills = bills
        .filter(b => b.status === "open" && !b.markedPaid && b.amountOpen > 0)
        .filter(b => b.criticality !== "critical")
        .sort((a, b) => b.amountOpen - a.amountOpen);

    for (const bill of delayableBills.slice(0, 3)) {
        // Suggest partial payment for larger bills to preserve relationship
        const suggestPartial = bill.amountOpen > 5000;
        const impact = suggestPartial ? bill.amountOpen * 0.5 : bill.amountOpen;
        
        actions.push({
            type: "delay_ap",
            priority: "p2",
            title: suggestPartial 
                ? `Delay 50% of $${bill.amountOpen.toLocaleString()} to ${bill.vendorName}`
                : `Delay $${bill.amountOpen.toLocaleString()} to ${bill.vendorName}`,
            description: suggestPartial
                ? `Bill ${bill.billNo}. Non-critical vendor — pay half now, negotiate net-15 on remainder to free $${impact.toLocaleString()}.`
                : `Bill ${bill.billNo}. Non-critical vendor — delaying 2 weeks frees cash.`,
            amountImpact: impact,
            impactCertainty: "high",
            constraintWeekStart: constraintWeekStr,
            targetType: "bill",
            targetId: bill.id,
            reasoningJson: JSON.stringify({
                constraintWeekStart: constraintWeekStr,
                gapAmountExpected: gapExpected,
                gapAmountWorst: gapWorst,
                selectedTargets: [bill.id],
                impactAmount: impact,
                impactCertainty: "high",
                strategy: suggestPartial ? "partial_payment_stretch" : "standard_delay"
            }),
        });
    }

    // ── Final sort: certainty first, then impact, then simplicity ─────
    const certOrder: Record<ImpactCertainty, number> = { high: 0, med: 1, low: 2 };
    actions.sort((a, b) => {
        // Risk alerts always first
        if (a.type === "risk_alert" && b.type !== "risk_alert") return -1;
        if (b.type === "risk_alert" && a.type !== "risk_alert") return 1;
        // Certainty
        if (certOrder[a.impactCertainty] !== certOrder[b.impactCertainty]) {
            return certOrder[a.impactCertainty] - certOrder[b.impactCertainty];
        }
        // Impact
        return b.amountImpact - a.amountImpact;
    });

    // Ensure top 2 most certain are always included
    // (They already are by construction since we sort certainty-first)

    if (input.rawForecastInput) {
        let baselineState: BusinessCashState = "safe";
        if (forecast.weeks[0]?.endCashExpected < 0) baselineState = "exhausted";
        else if (forecast.expectedRunOutWeek !== null) baselineState = "critical";
        else if (forecast.constraintWeek !== null) baselineState = "threatened";

        for (const action of actions) {
            if (action.type === "delay_ap" && action.targetId) {
                const clonedBills = input.rawForecastInput.bills.map(b => ({ ...b }));
                const targetBill = clonedBills.find(b => b.id === action.targetId);
                if (targetBill) {
                    const oldDate = targetBill.overrideDueDate || targetBill.dueDate || targetBill.billDate || new Date(input.rawForecastInput.asOfDate);
                    targetBill.overrideDueDate = new Date(new Date(oldDate).getTime() + 14 * 86400000);
                    
                    const simForecast = computeForecast({ ...input.rawForecastInput, bills: clonedBills });
                    
                    let runwayImprovementWeeks = 0;
                    if (forecast.constraintWeek !== null && simForecast.constraintWeek !== null) {
                        runwayImprovementWeeks = simForecast.constraintWeek - forecast.constraintWeek;
                    } else if (forecast.constraintWeek !== null && simForecast.constraintWeek === null) {
                        runwayImprovementWeeks = 13 - forecast.constraintWeek;
                    }

                    action.simulationDelta = {
                        constraintWeekBefore: forecast.constraintWeek,
                        constraintWeekAfter: simForecast.constraintWeek,
                        runwayImprovementWeeks,
                        worstCaseRunOutBefore: forecast.worstCaseRunOutWeek,
                        worstCaseRunOutAfter: simForecast.worstCaseRunOutWeek,
                        lowestBalanceDelta: simForecast.lowestExpectedBalance - forecast.lowestExpectedBalance,
                        improvesConstraint: runwayImprovementWeeks > 0 || (simForecast.lowestExpectedBalance > forecast.lowestExpectedBalance)
                    };
                }
            }
        }
    }

    return actions;
}
