// ui/ExecutionPlanModal.tsx — Printable "Week 1 Action Plan" for AR/AP clerks
// Sections: Approved to Pay | Collection Targets | Hold List
"use client";

import { useMemo, useState, useEffect } from "react";
import { Printer, CheckCircle, Phone, Lock, RefreshCw, Zap, Eye, EyeOff } from "lucide-react";
import type { WeekBreakdown, WeekBreakdownItem } from "@/domain/types";
import type { GridItem } from "./ARAPCard";

interface WeekMeta {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
}

interface Props {
    weeks: WeekMeta[];
    invoices: GridItem[];
    bills: GridItem[];
    openingCash: number;
    breakdown?: WeekBreakdown;
    onClose: () => void;
    executionPlan?: { id: string; version: number, planForecast?: any } | null;
    companyId?: string;
    forecastStateJson?: any;
    onApprove?: () => void;
    initialMode?: "select" | "approved" | "live";
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

function agingLabel(days: number | null | undefined): { text: string; urgent: boolean } {
    if (days == null) return { text: "Unknown", urgent: false };
    if (days <= 0)    return { text: days === 0 ? "Due today" : `Due in ${Math.abs(days)}d`, urgent: false };
    if (days <= 14)   return { text: `${days}d past due — send reminder`, urgent: false };
    if (days <= 30)   return { text: `${days}d past due — escalate`, urgent: true };
    if (days <= 60)   return { text: `${days}d past due — urgent call required`, urgent: true };
    return               { text: `${days}d past due — CRITICAL, call today`, urgent: true };
}

// ── Sub-components ─────────────────────────────────────────────────────────
function SectionHeader({ emoji, title, subtitle, color }: {
    emoji: React.ReactNode; title: string; subtitle: string; color: string;
}) {
    return (
        <div className="flex items-start gap-3 mb-4 pb-3 print-border-bottom" style={{ borderBottom: "2px solid " + color }}>
            <div style={{ padding: "4px 0" }}>{emoji}</div>
            <div>
                <h2 style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", margin: 0 }}>{title}</h2>
                <p style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>{subtitle}</p>
            </div>
        </div>
    );
}

function EmptySection({ message }: { message: string }) {
    return (
        <p style={{ fontSize: "12px", color: "#94a3b8", fontStyle: "italic", padding: "8px 0" }}>{message}</p>
    );
}


function NonLedgerRow({ item, isOutflow, isExcluded, onToggleExclude }: { item: WeekBreakdownItem; isOutflow: boolean; isExcluded: boolean; onToggleExclude: () => void }) {
    const isManual = item.sourceType === "manual";
    return (
        <tr className={isExcluded ? "no-print" : ""} style={{ borderBottom: "1px solid #e2e8f0", pageBreakInside: "avoid", opacity: isExcluded ? 0.35 : 1 }}>
            <td style={{ width: "28px", padding: "10px 8px 10px 0", verticalAlign: "top" }}>
                <div style={{
                    width: "16px", height: "16px", border: "1.5px solid #94a3b8",
                    borderRadius: "3px", display: "inline-block", flexShrink: 0
                }} />
            </td>
            <td style={{ padding: "10px 12px 10px 0", verticalAlign: "top", minWidth: "160px" }}>
                <div style={{ fontWeight: 600, fontSize: "12px", color: "#0f172a", textDecoration: isExcluded ? "line-through" : "none" }}>{item.label}</div>
                <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px" }}>
                    {isManual ? "Manual Cash Adjustment" : "Recurring Commitment"}
                </div>
            </td>
            <td style={{ padding: "10px 12px 10px 0", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap" }}>
                <span style={{ fontWeight: 700, fontSize: "13px", color: isOutflow ? "#dc2626" : "#059669", textDecoration: isExcluded ? "line-through" : "none" }}>
                    {isOutflow ? "−" : "+"}{fmt(item.amount)}
                </span>
            </td>
            <td style={{ padding: "10px 0", verticalAlign: "top", minWidth: "200px" }}>
                <span style={{
                    display: "inline-block", fontSize: "10px", fontWeight: 600, padding: "2px 7px",
                    borderRadius: "99px", background: "#f1f5f9", color: "#475569",
                    border: "1px solid #e2e8f0"
                }}>
                    {isExcluded ? "Excluded from Plan" : (isManual ? "One-time action" : "Verify / Execute")}
                </span>
            </td>
            <td style={{ padding: "10px 0", verticalAlign: "top", width: "130px" }}>
                <div style={{ borderBottom: "1px solid #cbd5e1", height: "14px", marginTop: "4px" }} />
            </td>
            <td className="no-print" style={{ width: "28px", padding: "10px 0", verticalAlign: "middle", textAlign: "right" }}>
                <button onClick={onToggleExclude} className="text-gray-400 hover:text-slate-700" title="Exclude from print">
                    {isExcluded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
            </td>
        </tr>
    );
}

function AutoDebitRow({ item, isExcluded, onToggleExclude }: { item: WeekBreakdownItem; isExcluded: boolean; onToggleExclude: () => void }) {
    return (
        <tr className={isExcluded ? "no-print" : ""} style={{ borderBottom: "1px solid #e2e8f0", pageBreakInside: "avoid", opacity: isExcluded ? 0.35 : 0.85 }}>
            <td style={{ width: "28px", padding: "10px 8px 10px 0", verticalAlign: "top" }}>
                <span className="text-gray-400 flex items-center justify-center pt-1"><RefreshCw className="w-3.5 h-3.5" /></span>
            </td>
            <td style={{ padding: "10px 12px 10px 0", verticalAlign: "top", minWidth: "160px" }}>
                <div style={{ fontWeight: 600, fontSize: "12px", color: "#0f172a", textDecoration: isExcluded ? "line-through" : "none" }}>{item.label}</div>
                <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px" }}>Recurring Auto-Debit</div>
            </td>
            <td style={{ padding: "10px 12px 10px 0", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap" }}>
                <span style={{ fontWeight: 700, fontSize: "13px", color: "#dc2626", textDecoration: isExcluded ? "line-through" : "none" }}>
                    −{fmt(item.amount)}
                </span>
            </td>
            <td colSpan={2} style={{ padding: "10px 0", verticalAlign: "top", fontSize: "10px", color: "#64748b" }}>
                <span style={{
                    display: "inline-block", fontSize: "10px", fontWeight: 600, padding: "2px 7px",
                    borderRadius: "99px", background: "#f8fafc", color: "#64748b",
                    border: "1px solid #e2e8f0"
                }}>
                    {isExcluded ? "Excluded from Plan" : "Auto-clears. Verify on bank feed."}
                </span>
            </td>
            <td className="no-print" style={{ width: "28px", padding: "10px 0", verticalAlign: "middle", textAlign: "right" }}>
                <button onClick={onToggleExclude} className="text-gray-400 hover:text-slate-700" title="Exclude from print">
                    {isExcluded ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
            </td>
        </tr>
    );
}

interface RowProps {
    item: GridItem;
    isHold?: boolean;
    originalDue?: string | null;
}

function ItemRow({ item, isHold, originalDue }: RowProps) {
    const isAR = item.kind === "ar";
    const name = isAR ? (item.customerName ?? item.label) : (item.vendorName ?? item.label);
    const ref  = isAR ? item.invoiceNo : item.billNo;
    const aging = agingLabel(item.daysPastDue);

    return (
        <tr style={{ borderBottom: "1px solid #e2e8f0", pageBreakInside: "avoid" }}>
            {/* Checkbox */}
            <td style={{ width: "28px", padding: "10px 8px 10px 0", verticalAlign: "top" }}>
                {!isHold && (
                    <div style={{
                        width: "16px", height: "16px", border: "1.5px solid #94a3b8",
                        borderRadius: "3px", display: "inline-block", flexShrink: 0
                    }} />
                )}
                {isHold && (
                    <span className="text-gray-400 flex items-center justify-center pt-1"><Lock className="w-3.5 h-3.5" /></span>
                )}
            </td>

            {/* Party + Ref */}
            <td style={{ padding: "10px 12px 10px 0", verticalAlign: "top", minWidth: "160px" }}>
                <div style={{ fontWeight: 600, fontSize: "12px", color: "#0f172a" }}>{name}</div>
                <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px" }}>{ref}</div>
            </td>

            {/* Amount */}
            <td style={{ padding: "10px 12px 10px 0", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap" }}>
                <span style={{
                    fontWeight: 700, fontSize: "13px",
                    color: isHold ? "#94a3b8" : isAR ? "#059669" : "#dc2626",
                    textDecoration: isHold ? "line-through" : "none"
                }}>
                    {isAR ? "+" : "−"}{fmt(item.amountOpen)}
                </span>
            </td>

            {/* Status / Instructions */}
            <td style={{ padding: "10px 0", verticalAlign: "top", minWidth: "200px" }}>
                {isHold ? (
                    <div>
                        <span style={{
                            display: "inline-block", fontSize: "10px", fontWeight: 600, padding: "2px 7px",
                            borderRadius: "99px", background: "#fef3c7", color: "#92400e",
                            border: "1px solid #fcd34d"
                        }}>
                            ⚠ DO NOT PAY/COLLECT YET
                        </span>
                        {originalDue && (
                            <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "4px" }}>
                                Originally due {fmtDate(originalDue)} — management deferred
                            </div>
                        )}
                    </div>
                ) : aging.urgent ? (
                    <span style={{
                        display: "inline-block", fontSize: "10px", fontWeight: 600, padding: "2px 7px",
                        borderRadius: "99px", background: "#fee2e2", color: "#991b1b",
                        border: "1px solid #fca5a5"
                    }}>
                        {aging.text}
                    </span>
                ) : (
                    <span style={{ fontSize: "11px", color: "#64748b" }}>{aging.text}</span>
                )}
            </td>

            {/* Notes — blank line for clerk */}
            <td style={{ padding: "10px 0", verticalAlign: "top", width: "130px" }}>
                {!isHold && (
                    <div style={{ borderBottom: "1px solid #cbd5e1", height: "14px", marginTop: "4px" }} />
                )}
            </td>
            <td className="no-print" style={{ width: "28px", padding: "10px 0", verticalAlign: "middle" }}>
                {/* Empty cell to align with exclude buttons on non-ledger rows */}
            </td>
        </tr>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────
export function ExecutionPlanModal({ weeks, invoices, bills, openingCash, breakdown, onClose, executionPlan, companyId, forecastStateJson, onApprove, initialMode = "select" }: Props) {
    const [activeTab, setActiveTab] = useState<"all" | "ar" | "ap">("all");
    const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
    const [mode, setMode] = useState<"select" | "approved" | "live">(initialMode);
    const [isApproving, setIsApproving] = useState(false);
    const [eligibleCheckpoints, setEligibleCheckpoints] = useState<any[] | null>(null);
    const [selectedCheckpointId, setSelectedCheckpointId] = useState<string>("");
    const [revisionReason, setRevisionReason] = useState("");
    const [persistedPlanData, setPersistedPlanData] = useState<any>(null);
    const [defaultOwner, setDefaultOwner] = useState("");

    useEffect(() => {
        if (!weeks?.[0]?.weekStart || mode !== "select") return;
        fetch(`/api/forecast-checkpoint/eligible?weekStart=${weeks[0].weekStart}`)
            .then(r => r.json())
            .then(data => {
                if (data.checkpoints) {
                    setEligibleCheckpoints(data.checkpoints);
                    if (data.checkpoints.length > 0) {
                        setSelectedCheckpointId(data.checkpoints[0].id);
                    }
                }
            })
            .catch(e => console.error(e));
    }, [weeks, mode]);

    useEffect(() => {
        if (mode === "approved" && executionPlan?.id && !persistedPlanData) {
            fetch(`/api/execution-plan/${executionPlan.id}`)
                .then(r => r.json())
                .then(data => {
                    if (data.plan) setPersistedPlanData(data.plan);
                })
                .catch(e => console.error(e));
        }
    }, [mode, executionPlan]);

    const [defaultDueDate, setDefaultDueDate] = useState(() => {
        const d = new Date();
        d.setDate(d.getDate() + 2);
        return d.toISOString().split("T")[0];
    });

    const handleApproveAndPrint = async () => {
        setIsApproving(true);
        try {
            const actions = [];

            for (const item of approvedToPay) {
                if (excludedIds.has(item.id)) continue;
                actions.push({
                    type: "pay_ap",
                    title: `Pay ${item.vendorName || item.label}`,
                    description: `Release payment for ${item.billNo || "bill"}`,
                    amountImpact: -Math.abs(item.amountOpen),
                    constraintWeekStart: week1.weekStart,
                    targetType: "bill",
                    targetId: item.id,
                    reasoningJson: { source: "approvedToPay" },
                    ownerName: defaultOwner,
                    dueDate: defaultDueDate
                });
            }

            for (const item of collectionTargets) {
                if (excludedIds.has(item.id)) continue;
                actions.push({
                    type: "collect_ar",
                    title: `Collect from ${item.customerName || item.label}`,
                    description: `Follow up on invoice ${item.invoiceNo || ""}`,
                    amountImpact: Math.abs(item.amountOpen),
                    constraintWeekStart: week1.weekStart,
                    targetType: "invoice",
                    targetId: item.id,
                    reasoningJson: { source: "collectionTargets" },
                    ownerName: defaultOwner,
                    dueDate: defaultDueDate
                });
            }

            for (const item of manualOutflows) {
                const id = item.sourceId || item.label;
                if (excludedIds.has(id)) continue;
                actions.push({
                    type: "manual_outflow",
                    title: item.label,
                    description: `Process manual outflow`,
                    amountImpact: -Math.abs(item.amount),
                    constraintWeekStart: week1.weekStart,
                    targetType: item.sourceType === "recurring" ? "recurring" : "cash",
                    targetId: item.sourceId || null,
                    reasoningJson: { source: "manualOutflows" },
                    ownerName: defaultOwner,
                    dueDate: defaultDueDate
                });
            }

            for (const item of manualInflows) {
                const id = item.sourceId || item.label;
                if (excludedIds.has(id)) continue;
                actions.push({
                    type: "manual_inflow",
                    title: item.label,
                    description: `Process manual inflow`,
                    amountImpact: Math.abs(item.amount),
                    constraintWeekStart: week1.weekStart,
                    targetType: "cash",
                    targetId: item.sourceId || null,
                    reasoningJson: { source: "manualInflows" },
                    ownerName: defaultOwner,
                    dueDate: defaultDueDate
                });
            }

            for (const { item, originalDue } of holdItems) {
                if (excludedIds.has(item.id)) continue;
                const isAR = item.kind === "ar";
                actions.push({
                    type: isAR ? "defer_ar" : "defer_ap",
                    title: `Hold ${isAR ? item.customerName || item.label : item.vendorName || item.label}`,
                    description: `Do not process ${isAR ? "invoice" : "bill"} ${item.invoiceNo || item.billNo || ""}`,
                    amountImpact: isAR ? -Math.abs(item.amountOpen) : Math.abs(item.amountOpen),
                    constraintWeekStart: week1.weekStart,
                    targetType: isAR ? "invoice" : "bill",
                    targetId: item.id,
                    reasoningJson: { source: "holdItems", originalDue },
                    ownerName: defaultOwner,
                    dueDate: defaultDueDate
                });
            }


            const res = await fetch("/api/execution-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    weekStart: week1.weekStart,
                    forecastCheckpointId: selectedCheckpointId,
                    expectedCurrentPlanId: executionPlan ? executionPlan.id : null,
                    revisionReason,
                    actions
                }),
            });

            if (res.ok) {
                const data = await res.json();
                const planId = data.plan?.id || data.id;

                if (planId) {
                    const detailRes = await fetch(`/api/execution-plan/${planId}`);
                    if (detailRes.ok) {
                        const detailData = await detailRes.json();
                        if (detailData.plan) {
                            setPersistedPlanData(detailData.plan);
                        }
                    }
                }

                onApprove?.();
                setMode("approved");
                setTimeout(() => window.print(), 300);
            }
        } finally {
            setIsApproving(false);
        }
    };


    const isLive = mode === "live" || mode === "select" || !persistedPlanData;
    const planForecast = persistedPlanData?.forecastCheckpoint?.canonicalPayloadJson ? JSON.parse(persistedPlanData.forecastCheckpoint.canonicalPayloadJson) : null;

    // Resolve which data to render
    const activeWeeks = isLive ? weeks : persistedPlanData?.forecastCheckpoint?.ForecastWeeks;
    const activeInvoices = isLive ? invoices : planForecast?.invoices;
    const activeBills = isLive ? bills : planForecast?.bills;
    const activeOpeningCash = isLive ? openingCash : planForecast?.input?.adjustedOpeningCash;
    const activeBreakdown = isLive ? breakdown : planForecast?.weeks?.[0]?.breakdown;

    // Fail closed if approved mode lacks data
    if (!isLive) {
        if (!activeWeeks || activeWeeks.length !== 13 || !planForecast || !persistedPlanData?.actionItems) {
            return (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm no-print">
                    <div className="bg-white p-6 rounded text-rose-600 font-bold shadow-2xl max-w-lg">
                        <h2 className="mb-2 text-lg">Error: Missing Approved Data</h2>
                        <p className="text-sm font-normal">
                            Cannot render approved plan. Missing required persisted data (Checkpoint, canonicalPayloadJson, ActionItems, or exactly 13 ForecastWeeks). Failing closed to prevent false representations.
                        </p>
                        <button onClick={onClose} className="mt-4 px-4 py-2 bg-slate-100 rounded text-slate-800 text-sm border hover:bg-slate-200">Close</button>
                    </div>
                </div>
            );
        }
    }


    const toggleExclude = (id: string) => {
        setExcludedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const week1 = weeks[0];
    const printDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    // ── Data derivation ────────────────────────────────────────────────────
    const {
        approvedToPay,
        collectionTargets,
        holdItems,
        manualOutflows,
        manualInflows,
        automatedOutflows,
        totalCollect,
        totalPay,
        totalAutoOutflows
    } = useMemo(() => {
        if (!isLive && persistedPlanData && persistedPlanData.actionItems) {
            const ap: GridItem[] = [];
            const ar: GridItem[] = [];
            const mOut: WeekBreakdownItem[] = [];
            const mIn: WeekBreakdownItem[] = [];
            const holds: { item: GridItem; originalDue: string | null }[] = [];
            let tCollect = 0;
            let tPay = 0;

            for (const a of persistedPlanData.actionItems) {
                if (a.type === 'pay_ap') {
                    ap.push({
                        id: a.targetId, kind: 'ap', label: a.title, vendorName: a.title, amountOpen: Math.abs(a.amountImpact),
                        daysPastDue: 0, effectiveWeek: 1
                    } as GridItem);
                    tPay += Math.abs(a.amountImpact);
                } else if (a.type === 'collect_ar') {
                    ar.push({
                        id: a.targetId, kind: 'ar', label: a.title, customerName: a.title, amountOpen: Math.abs(a.amountImpact),
                        daysPastDue: 0, effectiveWeek: 1
                    } as GridItem);
                    tCollect += Math.abs(a.amountImpact);
                } else if (a.type === 'manual_outflow') {
                    mOut.push({ sourceId: a.targetId, sourceType: 'manual', label: a.title, amount: Math.abs(a.amountImpact) } as WeekBreakdownItem);
                    tPay += Math.abs(a.amountImpact);
                } else if (a.type === 'manual_inflow') {
                    mIn.push({ sourceId: a.targetId, sourceType: 'manual', label: a.title, amount: Math.abs(a.amountImpact) } as WeekBreakdownItem);
                    tCollect += Math.abs(a.amountImpact);
                } else if (a.type === 'defer_ar' || a.type === 'defer_ap') {
                    holds.push({
                        item: { id: a.targetId, kind: a.type === 'defer_ar' ? 'ar' : 'ap', label: a.title, amountOpen: Math.abs(a.amountImpact) } as GridItem,
                        originalDue: a.reasoningJson?.originalDue || null
                    });
                }
            }

            return {
                approvedToPay: ap.sort((a,b)=>b.amountOpen - a.amountOpen),
                collectionTargets: ar.sort((a,b)=>b.amountOpen - a.amountOpen),
                holdItems: holds,
                manualOutflows: mOut,
                manualInflows: mIn,
                automatedOutflows: [],
                totalCollect: tCollect,
                totalPay: tPay,
                totalAutoOutflows: 0
            };
        }

        // Active Week 1 items
        const collectionTargets = activeInvoices
            .filter((i: GridItem) => i.effectiveWeek === 1)
            .sort((a: GridItem, b: GridItem) => (b.daysPastDue ?? 0) - (a.daysPastDue ?? 0)); // most urgent first

        const approvedToPay = activeBills
            .filter((b: GridItem) => b.effectiveWeek === 1)
            .sort((a: GridItem, b: GridItem) => b.amountOpen - a.amountOpen); // largest first

        // Hold list: items whose ORIGINAL due date falls in Week 1's window
        // but management has moved out of Week 1 (override set, effectiveWeek !== 1)
        const w1Start = new Date(week1.weekStart);
        const w1End   = new Date(week1.weekEnd);

        const holdItems: { item: GridItem; originalDue: string | null }[] = [];
        for (const item of [...activeInvoices, ...activeBills]) {
            if (!item.overrideDate) continue;
            if (item.effectiveWeek === 1) continue; // it's IN week 1, not deferred
            const originalDue = item.dueDate;
            if (!originalDue) continue;
            const due = new Date(originalDue);
            if (due >= w1Start && due <= w1End) {
                holdItems.push({ item, originalDue });
            }
        }
        holdItems.sort((a, b) => b.item.amountOpen - a.item.amountOpen);

        const manualOutflows: WeekBreakdownItem[] = [];
        const manualInflows: WeekBreakdownItem[] = [];
        const automatedOutflows: WeekBreakdownItem[] = [];

        if (activeBreakdown) {
            for (const item of activeBreakdown.outflows) {
                if (item.sourceType === "baseline" || item.sourceType === "assumption" || item.sourceType === "bill") continue;
                if (item.sourceType === "manual") {
                    manualOutflows.push(item);
                } else if (item.sourceType === "recurring") {
                    const l = item.label.toLowerCase();
                    if (l.includes("payroll") || l.includes("rent") || l.includes("tax")) {
                        manualOutflows.push(item);
                    } else {
                        automatedOutflows.push(item);
                    }
                }
            }
            for (const item of activeBreakdown.inflows) {
                if (item.sourceType === "baseline" || item.sourceType === "invoice") continue;
                if (item.sourceType === "manual") {
                    manualInflows.push(item);
                }
            }
        }

        const baseTotalCollect = collectionTargets.reduce((s: number, i: any) => s + i.amountOpen, 0);
        const baseTotalPay = approvedToPay.reduce((s: number, i: any) => s + i.amountOpen, 0);

        const mCollect = manualInflows.filter((i: any) => !excludedIds.has(i.sourceId || i.label)).reduce((s: number, i: any) => s + i.amount, 0);
        const mPay = manualOutflows.filter((i: any) => !excludedIds.has(i.sourceId || i.label)).reduce((s: number, i: any) => s + i.amount, 0);
        const aPay = automatedOutflows.filter((i: any) => !excludedIds.has(i.sourceId || i.label)).reduce((s: number, i: any) => s + i.amount, 0);

        return {
            approvedToPay, collectionTargets, holdItems,
            manualOutflows, manualInflows, automatedOutflows,
            totalCollect: baseTotalCollect + mCollect,
            totalPay: baseTotalPay + mPay,
            totalAutoOutflows: aPay
        };
    }, [activeInvoices, activeBills, week1, activeBreakdown, excludedIds, isLive, persistedPlanData]);

    const showAR = activeTab === "all" || activeTab === "ar";
    const showAP = activeTab === "all" || activeTab === "ap";
    const hasActions = (approvedToPay.length + collectionTargets.length + manualOutflows.length + manualInflows.length + holdItems.length) > 0;

    if (mode === "select") {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md animate-in fade-in slide-in-from-bottom-4">
                    <h2 className="text-lg font-bold text-slate-900 mb-4">Print Execution Plan</h2>
                    {(() => {
                        const content = (
                            <div className="space-y-3">
                                <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 mb-4 space-y-3">
                                    {eligibleCheckpoints === null ? (
                                        <div className="text-sm text-slate-500">Loading eligible checkpoints...</div>
                                    ) : eligibleCheckpoints.length === 0 ? (
                                        <div className="text-sm font-bold text-rose-600">
                                            An immutable forecast must first be created before approval.
                                        </div>
                                    ) : (
                                        <>
                                            <div>
                                                <div className="text-sm font-bold text-slate-800 mb-1">Bind to Forecast Checkpoint</div>
                                                <select
                                                    value={selectedCheckpointId}
                                                    onChange={e => setSelectedCheckpointId(e.target.value)}
                                                    className="w-full text-sm p-2 border rounded border-slate-300"
                                                >
                                                    {eligibleCheckpoints.map(cp => (
                                                        <option key={cp.id} value={cp.id}>
                                                            {new Date(cp.sealedAt).toLocaleString()} — {cp.forecastVersionHash.substring(0, 8)}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        </>
                                    )}

                                    {executionPlan && (
                                        <div>
                                            <div className="text-sm font-bold text-slate-800 mb-1">Revision Reason</div>
                                            <input
                                                type="text"
                                                placeholder="Why are we revising?"
                                                value={revisionReason}
                                                onChange={e => setRevisionReason(e.target.value)}
                                                className="w-full text-sm p-2 border rounded border-slate-300"
                                            />
                                        </div>
                                    )}

                                    <div className="text-sm font-bold text-slate-800 mt-2 mb-1">Assignment Details</div>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            placeholder="Owner Name (Required)"
                                            value={defaultOwner}
                                            onChange={e => setDefaultOwner(e.target.value)}
                                            className="flex-1 text-sm p-2 border rounded border-slate-300"
                                        />
                                        <input
                                            type="date"
                                            value={defaultDueDate}
                                            onChange={e => setDefaultDueDate(e.target.value)}
                                            className="w-36 text-sm p-2 border rounded border-slate-300"
                                        />
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleApproveAndPrint()}
                                    disabled={isApproving || eligibleCheckpoints?.length === 0 || (!defaultOwner || !defaultDueDate) || Boolean(executionPlan && !revisionReason)}
                                    className="w-full text-left p-4 rounded-lg border border-indigo-200 bg-indigo-50 hover:border-indigo-500 hover:bg-indigo-100 transition-colors disabled:opacity-50"
                                >
                                    <div className="font-bold text-indigo-900">{isApproving ? "Approving..." : (executionPlan ? "Approve & Print Revised Plan" : "Approve & Print Plan")}</div>
                                    <div className="text-xs text-indigo-700">{executionPlan ? "Creates a new version and supersedes the old" : "Creates the initial baseline"}</div>
                                </button>
                                <button onClick={() => setMode("live")} className="w-full text-left p-4 rounded-lg border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 transition-colors">
                                    <div className="font-bold text-slate-900">Print Live Forecast Only</div>
                                    <div className="text-xs text-slate-500">Does not approve the plan</div>
                                </button>
                            </div>
                        );
                        return content;
                    })()}
                    <button onClick={onClose} className="w-full mt-4 p-3 rounded-lg text-sm font-bold text-slate-600 hover:bg-slate-100 transition-colors text-center">
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    return (
        <>
            {/* Print CSS injected into head */}
            <style>{`
                @media print {
                    body { visibility: hidden; }
                    #execution-plan-overlay {
                        visibility: visible;
                        position: absolute !important;
                        left: 0; top: 0;
                        width: 100%;
                        height: auto !important;
                        display: block !important;
                        overflow: visible !important;
                        background: white !important;
                    }
                    #execution-plan-overlay * { visibility: visible; }
                    #execution-plan-scroll-container {
                        overflow: visible !important;
                        height: auto !important;
                        display: block !important;
                    }
                    #execution-plan-modal-header { display: none !important; }
                    #execution-plan-tabs { display: none !important; }
                    .no-print, .no-print * { display: none !important; }
                    @page { margin: 1.2cm 1.4cm; }
                }
            `}</style>

            {/* Overlay */}
            <div
                id="execution-plan-overlay"
                className="fixed inset-0 z-50 flex flex-col"
                style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            >
                {/* Modal chrome (hidden on print) */}
                <div id="execution-plan-modal-header"
                    className="no-print flex-shrink-0 flex items-center justify-between px-6 py-3"
                    style={{ background: "#0f172a", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
                >
                    <div className="flex items-center gap-3">
                        <Printer className="w-6 h-6 text-gray-400" />
                        <div>
                            <p className="text-sm font-bold text-white">

                                {mode === "approved" ? `Approved Weekly Plan — Version ${executionPlan?.version}` : "Current Live Forecast — Not Approved"}
                            </p>
                            <p className="text-xs" style={{ color: "#64748b" }}>
                                {mode === "approved" && persistedPlanData?.forecastCheckpoint ? (
                                    <>Bound to Sealed Checkpoint: {persistedPlanData.forecastCheckpoint.forecastVersionHash.substring(0, 8)}</>
                                ) : mode === "approved" ? (
                                    <>LEGACY / UNBOUND</>
                                ) : (
                                    <>Clerk execution handoff · {week1 ? `${fmtDate(week1.weekStart)} – ${fmtDate(week1.weekEnd)}` : ""}</>
                                )}
                            </p>

                        </div>
                    </div>

                    <div className="flex items-center gap-3">


                        {/* Tab filter */}
                        <div id="execution-plan-tabs" className="flex rounded-lg overflow-hidden border text-[11px] font-semibold" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
                            {(["all", "ar", "ap"] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className="px-3 py-1.5 border-l first:border-l-0"
                                    style={{
                                        borderColor: "rgba(255,255,255,0.10)",
                                        background: activeTab === tab ? "rgba(255,255,255,0.12)" : "transparent",
                                        color: activeTab === tab ? "#fff" : "#64748b",
                                    }}
                                >
                                    {tab === "all" ? "Full Plan" : tab === "ar" ? "AR Only" : "AP Only"}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={() => window.print()}
                            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold"
                            style={{ background: "#2563eb", color: "#fff" }}
                        >
                            <Printer className="w-4 h-4" /> Print / Save PDF
                        </button>

                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white text-lg leading-none px-2"
                        >
                            ×
                        </button>
                    </div>
                </div>

                {/* Printable body */}
                <div
                    id="execution-plan-scroll-container"
                    className="flex-1 overflow-auto"
                    style={{ background: "#f8fafc" }}
                >
                    <div
                        style={{
                            maxWidth: "860px",
                            margin: "0 auto",
                            padding: "36px 40px 60px",
                            background: "#ffffff",
                            minHeight: "100%",
                            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                        }}
                    >
                        {/* ── Document Header ─────────────────────────────────────── */}
                        <div style={{ borderBottom: "3px solid #0f172a", paddingBottom: "16px", marginBottom: "24px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                    <h1 style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", margin: 0 }}>
                                        Cash Execution Plan
                                    </h1>
                                    <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                                        Week of {week1 ? `${fmtDate(week1.weekStart)} — ${fmtDate(week1.weekEnd)}` : "—"}
                                    </p>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                    <p style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Generated</p>
                                    <p style={{ fontSize: "11px", color: "#475569", fontWeight: 500 }}>{printDate}</p>
                                    <p style={{ fontSize: "10px", color: "#dc2626", fontWeight: 700, marginTop: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Confidential · Internal Use Only</p>
                                </div>
                            </div>

                            {/* Identity Fields Required by Package 1C */}
                            {!isLive && persistedPlanData ? (
                                <div style={{ marginTop: "16px", padding: "12px", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "6px", fontSize: "10px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                                    <div><strong>Plan ID:</strong> {persistedPlanData.id}</div>
                                    <div><strong>Status:</strong> <span style={{color: "#059669", fontWeight: "bold", textTransform: "uppercase"}}>{persistedPlanData.status}</span></div>
                                    <div><strong>Version:</strong> {persistedPlanData.version}</div>
                                    <div><strong>Week:</strong> {fmtDate(persistedPlanData.weekStart)}</div>
                                    <div><strong>Approved At:</strong> {fmtDate(persistedPlanData.approvedAt)}</div>
                                    <div><strong>Approved By:</strong> {persistedPlanData.approvedBy}</div>

                                    {persistedPlanData.forecastCheckpoint ? (
                                        <>
                                            <div><strong>Checkpoint ID:</strong> {persistedPlanData.forecastCheckpointId}</div>
                                            <div><strong>Sealed At:</strong> {fmtDate(persistedPlanData.forecastCheckpoint.sealedAt)}</div>
                                            <div style={{gridColumn: "1 / -1", wordBreak: "break-all"}}><strong>Full Checkpoint Hash:</strong> {persistedPlanData.forecastCheckpoint.forecastVersionHash}</div>
                                            <div><strong>Schema:</strong> v{persistedPlanData.forecastCheckpoint.forecastSchemaVersion}</div>
                                            <div><strong>Algorithm:</strong> {persistedPlanData.forecastCheckpoint.hashAlgorithm}</div>
                                        </>
                                    ) : (
                                        <div style={{gridColumn: "1 / -1", color: "#b45309", fontWeight: "bold", background: "#fef3c7", padding: "4px", borderRadius: "4px", border: "1px solid #fcd34d"}}>
                                            LEGACY / UNBOUND — NOT DECISION-PROOF
                                        </div>
                                    )}

                                    {persistedPlanData.supersededAt && (
                                        <>
                                            <div><strong>Superseded At:</strong> {fmtDate(persistedPlanData.supersededAt)}</div>
                                            <div><strong>Superseded By Plan ID:</strong> {persistedPlanData.supersededByPlanId}</div>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <div style={{ marginTop: "16px", padding: "8px", background: "#fee2e2", border: "1px solid #fca5a5", borderRadius: "6px", fontSize: "11px", color: "#991b1b", fontWeight: "bold", textAlign: "center" }}>
                                    LIVE FORECAST — NOT APPROVED
                                </div>
                            )}

                        {/* Summary band */}
                        <div style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(5, 1fr)",
                                gap: "10px",
                                marginTop: "20px",
                            }}>
                                {[
                                    { label: "Opening Cash", value: fmt(activeOpeningCash), color: "#0f172a" },
                                    { label: "Target Collect", value: `+${fmt(totalCollect)}`, color: "#059669" },
                                    { label: "To Pay (Manual)", value: `−${fmt(totalPay)}`, color: "#dc2626" },
                                    { label: "Auto-Debits", value: `−${fmt(totalAutoOutflows)}`, color: "#f59e0b" },
                                    { label: "Safe Buffer", value: fmt(activeOpeningCash + totalCollect - totalPay - totalAutoOutflows), color: (activeOpeningCash + totalCollect - totalPay - totalAutoOutflows) >= 0 ? "#0f172a" : "#dc2626" },
                                ].map(({ label, value, color }) => (
                                    <div key={label} style={{
                                        background: "#f1f5f9",
                                        borderRadius: "8px",
                                        padding: "10px 14px",
                                        border: "1px solid #e2e8f0",
                                    }}>
                                        <p style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600, margin: 0 }}>{label}</p>
                                        <p style={{ fontSize: "16px", fontWeight: 800, color, margin: "4px 0 0" }}>{value}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ── PART 1: APPROVED TO PAY (AP) ────────────────────────── */}
                        {showAP && (
                            <div style={{ marginBottom: "40px", pageBreakInside: "avoid" }}>
                                <SectionHeader
                                    emoji={<CheckCircle className="w-6 h-6 text-red-600" />}
                                    title="Approved to Pay"
                                    subtitle={`${approvedToPay.length} vendor payment${approvedToPay.length !== 1 ? "s" : ""} authorized for this week · Total: ${fmt(totalPay)}`}
                                    color="#dc2626"
                                />

                                {(approvedToPay.length === 0 && manualOutflows.length === 0) ? (
                                    <EmptySection message="No bills are scheduled for this week." />
                                ) : (
                                    <>
                                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                                            <thead>
                                                <tr style={{ borderBottom: "1px solid #cbd5e1" }}>
                                                    <th style={{ width: "28px" }} />
                                                    <th style={{ textAlign: "left", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Vendor / Bill #</th>
                                                    <th style={{ textAlign: "right", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Amount</th>
                                                    <th style={{ textAlign: "left", padding: "4px 0 8px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Priority / Status</th>
                                                    <th style={{ textAlign: "left", padding: "4px 0 8px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600, width: "130px" }}>Notes</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {approvedToPay.map((item: any) => (
                                                    <ItemRow key={item.id} item={item} />
                                                ))}
                                                {manualOutflows.map((item: any) => {
                                                    const id = item.sourceId || item.label;
                                                    return <NonLedgerRow key={item.label} item={item} isOutflow={true} isExcluded={excludedIds.has(id)} onToggleExclude={() => toggleExclude(id)} />;
                                                })}
                                            </tbody>
                                        </table>
                                        <div style={{
                                            marginTop: "12px", padding: "8px 12px",
                                            background: "#fef2f2", border: "1px solid #fecaca",
                                            borderRadius: "6px", fontSize: "10px", color: "#7f1d1d"
                                        }}>
                                            ⚠ <strong>Do not release payments outside this list</strong> without management authorization.
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* ── PART 2: COLLECTION TARGETS (AR) ─────────────────────── */}
                        {showAR && (
                            <div style={{ marginBottom: "40px", pageBreakInside: "avoid" }}>
                                <SectionHeader
                                    emoji={<Phone className="w-6 h-6 text-emerald-600" />}
                                    title="Collection Targets"
                                    subtitle={`${collectionTargets.length} invoice${collectionTargets.length !== 1 ? "s" : ""} to follow up on this week · Target: ${fmt(totalCollect)}`}
                                    color="#059669"
                                />

                                {(collectionTargets.length === 0 && manualInflows.length === 0) ? (
                                    <EmptySection message="No invoices are expected this week." />
                                ) : (
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                                        <thead>
                                            <tr style={{ borderBottom: "1px solid #cbd5e1" }}>
                                                <th style={{ width: "28px" }} />
                                                <th style={{ textAlign: "left", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Customer / Invoice #</th>
                                                <th style={{ textAlign: "right", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Amount</th>
                                                <th style={{ textAlign: "left", padding: "4px 0 8px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Urgency / Tone</th>
                                                <th style={{ textAlign: "left", padding: "4px 0 8px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600, width: "130px" }}>Outcome</th>
                                                <th className="no-print" style={{ width: "28px" }} />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {collectionTargets.map((item: any) => (
                                                <ItemRow key={item.id} item={item} />
                                            ))}
                                            {manualInflows.map((item: any) => {
                                                const id = item.sourceId || item.label;
                                                return <NonLedgerRow key={item.label} item={item} isOutflow={false} isExcluded={excludedIds.has(id)} onToggleExclude={() => toggleExclude(id)} />;
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        )}

                                                {/* ── PART 3: AUTOMATED OUTFLOWS ────────────────────────────────────── */}
                        {showAP && (
                            <div style={{ marginBottom: "40px", pageBreakInside: "avoid" }}>
                                <SectionHeader
                                    emoji={<RefreshCw className="w-6 h-6 text-amber-500" />}
                                    title="Automated Outflows (Verify)"
                                    subtitle={`${automatedOutflows.length} expected auto-debit${automatedOutflows.length !== 1 ? "s" : ""} · Total: ${fmt(totalAutoOutflows)}`}
                                    color="#f59e0b"
                                />

                                {automatedOutflows.length === 0 ? (
                                    <EmptySection message="No auto-debits expected this week." />
                                ) : (
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                                        <thead>
                                            <tr style={{ borderBottom: "1px solid #cbd5e1" }}>
                                                <th style={{ width: "28px" }} />
                                                <th style={{ textAlign: "left", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Party / Description</th>
                                                <th style={{ textAlign: "right", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Amount</th>
                                                <th style={{ textAlign: "left", padding: "4px 0 8px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Instruction</th>
                                                <th style={{ width: "130px" }} />
                                                <th className="no-print" style={{ width: "28px" }} />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {automatedOutflows.map((item: any) => {
                                                const id = item.sourceId || item.label;
                                                return <AutoDebitRow key={item.label} item={item} isExcluded={excludedIds.has(id)} onToggleExclude={() => toggleExclude(id)} />;
                                            })}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        )}

                        {/* ── PART 4: HOLD LIST ────────────────────────────────────── */}
                        {showAP && (
                            <div style={{ marginBottom: "40px", pageBreakInside: "avoid" }}>
                                <SectionHeader
                                    emoji={<Lock className="w-6 h-6 text-amber-500" />}
                                    title="Hold List — Do Not Process"
                                    subtitle={`${holdItems.length} item${holdItems.length !== 1 ? "s" : ""} originally due this week but deferred by management. Your accounting software may still show these as due.`}
                                    color="#f59e0b"
                                />

                                {holdItems.length === 0 ? (
                                    <EmptySection message="No items were deferred out of this week." />
                                ) : (
                                    <>
                                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                                            <thead>
                                                <tr style={{ borderBottom: "1px solid #cbd5e1" }}>
                                                    <th style={{ width: "28px" }} />
                                                    <th style={{ textAlign: "left", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Party / Ref #</th>
                                                    <th style={{ textAlign: "right", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Amount</th>
                                                    <th style={{ textAlign: "left", padding: "4px 0 8px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Management Instruction</th>
                                                    <th style={{ width: "130px" }} />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {holdItems.map(({ item, originalDue }) => (
                                                    <ItemRow key={item.id} item={item} isHold originalDue={originalDue} />
                                                ))}
                                            </tbody>
                                        </table>
                                        <div style={{
                                            marginTop: "12px", padding: "8px 12px",
                                            background: "#fffbeb", border: "1px solid #fde68a",
                                            borderRadius: "6px", fontSize: "10px", color: "#78350f"
                                        }}>
                                            ℹ If a vendor or customer contacts you about an item on this list, escalate to management before taking action.
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* ── Signature footer ─────────────────────────────────────── */}
                        <div style={{
                            borderTop: "1px solid #e2e8f0",
                            paddingTop: "24px",
                            marginTop: "40px",
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1fr",
                            gap: "40px",
                        }}>
                            {["Prepared by", "Reviewed by", "Authorized by"].map(label => (
                                <div key={label}>
                                    <div style={{ borderBottom: "1px solid #94a3b8", height: "28px", marginBottom: "6px" }} />
                                    <p style={{ fontSize: "10px", color: "#94a3b8" }}>{label}</p>
                                </div>
                            ))}
                        </div>

                        <p style={{ fontSize: "9px", color: "#cbd5e1", textAlign: "center", marginTop: "32px" }}>
                            Generated by Cash Flow Decision OS · {printDate} · This document is confidential and intended for internal use only.
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
}
