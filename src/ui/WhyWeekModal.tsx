// ui/WhyWeekModal.tsx – Breakdown for any selected week + AR/AP reschedule
"use client";

import { useState } from "react";
import { TrendingUp, PlaneTakeoff, BarChart2, Calendar, AlertTriangle, ArrowUpRight, ArrowDownRight, Target, ArrowRight, ChevronLeft, ChevronRight, RotateCcw, X } from "lucide-react";
import type { ScenarioItem } from "./ScenarioBuilder";

interface BreakdownItem {
    label: string;
    amount: number;
    type: string;
    sourceType: string;
    sourceId?: string;
    confidence: string;
    section?: string;
    metadata?: any;
}

interface WeekData {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    startCash: number;
    endCashExpected: number;
    endCashBest: number;
    endCashWorst: number;
    inflowsExpected: number;
    outflowsExpected: number;
    zone: string;
    breakdown: {
        inflows: BreakdownItem[];
        outflows: BreakdownItem[];
    };
    worstCaseDriver: string | null;
}

interface Props {
    week: WeekData;
    weekNumber: number;
    weekStart: string;       // ISO string — the Monday of this week (for reschedule origin)
    companyId: string;
    scenarioItems?: ScenarioItem[];
    /** Which outer view the user came from — shapes the hero context panel */
    viewMode?: "chart" | "runway" | "pulse";
    onReschedule: () => void;
    onNavigateWeek?: (delta: number) => void;
    onClose: () => void;
}

function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0 });
}

const typeBadge: Record<string, string> = {
    committed: "text-emerald-700 bg-emerald-50 px-1 rounded",
    assumed: "text-amber-700 bg-amber-50 px-1 rounded",
    scenario: "text-amber-600 bg-amber-50 px-1 rounded",
    overridden: "text-blue-700 bg-blue-50 px-1 rounded",
    rescheduled: "text-blue-600 bg-blue-50 px-1 rounded",
};

const confidenceDot: Record<string, string> = {
    high: "text-emerald-600",
    med: "text-amber-600",
    low: "text-red-600",
};

const SECTION_ORDER = [
    "AR Receipts",
    "Recurring Inflows",
    "Baseline Inflow",
    "What-If (Inflows)",
    "AP Bills",
    "Recurring Commitments",
    "Fixed Weekly Assumption",
    "Baseline Outflow",
    "What-If (Outflows)",
];

function groupBySection(items: BreakdownItem[]): Map<string, BreakdownItem[]> {
    const groups = new Map<string, BreakdownItem[]>();
    for (const s of SECTION_ORDER) groups.set(s, []);

    for (const item of items) {
        const section = item.section ?? (item.sourceType === "invoice" ? "AR Receipts"
            : item.sourceType === "bill" ? "AP Bills"
                : item.sourceType === "baseline" ? "Baseline"
                    : "Other");
        if (!groups.has(section)) groups.set(section, []);
        groups.get(section)!.push(item);
    }
    for (const [k, v] of groups) {
        if (v.length === 0) groups.delete(k);
    }
    return groups;
}

// ── View-specific hero context panel ────────────────────────────────────────
// ── Visual Components: Donut & Waterfall ─────────────────────────────────────

// ── Visual Components: Donut & Waterfall ─────────────────────────────────────

function CategoryDonut({ items, size = 60 }: { items: BreakdownItem[]; size?: number }) {
    if (items.length === 0) return null;
    const total = items.reduce((s, i) => s + i.amount, 0);
    const radius = size / 2 - 6;
    const circumference = 2 * Math.PI * radius;
    
    // Simple 2-category split for the pie
    const recurring = items.filter(i => i.sourceType === "recurring" || i.section?.includes("Recurring")).reduce((s, i) => s + i.amount, 0);
    const oneOff = total - recurring;
    
    const recP = (recurring / total);
    
    return (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="transform -rotate-90">
                <circle cx={size/2} cy={size/2} r={radius} fill="transparent" stroke="rgba(0,0,0,0.05)" strokeWidth="6" />
                {/* One-off Segment */}
                <circle
                    cx={size/2} cy={size/2} r={radius} fill="transparent"
                    stroke="#8b5cf6" strokeWidth="6"
                    strokeDasharray={circumference}
                    strokeDashoffset={0}
                />
                {/* Recurring Segment Overlay */}
                <circle
                    cx={size/2} cy={size/2} r={radius} fill="transparent"
                    stroke="#f43f5e" strokeWidth="6"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - recP)}
                />
            </svg>
        </div>
    );
}

function ViewContextHero({ week, viewMode, buffer }: { week: WeekData; viewMode: "chart" | "runway" | "pulse"; buffer?: number; activeSection?: string | null }) {
    const net = week.endCashExpected - week.startCash;
    const isPositiveWeek = net >= 0;
    const bufferTarget = buffer ?? 0;
    const distFromBuffer = week.endCashExpected - bufferTarget;
    const fuel = bufferTarget > 0 ? Math.max(0, Math.min(1, week.endCashExpected / (bufferTarget * 2))) : 0;
    
    const inflowTotal = week.inflowsExpected;
    const outflowTotal = week.outflowsExpected;
    const riskAmount = week.endCashExpected - week.endCashWorst;

    // ── Equation-style Bridge (Focus on simplicity and logic) ────────────────
    if (viewMode === "chart" || viewMode === "pulse") {
        return (
            <div className="mx-6 mt-4">
                <div className="rounded-xl px-5 py-6 border shadow-sm relative overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
                    
                    {/* Primary Answer: Ending Cash */}
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-3">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Position Analysis</p>
                            <span className="text-[9px] px-2 py-0.5 rounded-full font-bold bg-slate-900 text-white uppercase tracking-[0.1em] border border-white/10">Engine Confidence: {week.breakdown.inflows[0]?.confidence || "High"}</span>
                        </div>
                        <h3 className={`text-5xl font-bold font-financial tracking-tight leading-none ${week.endCashExpected < 0 ? "text-rose-600" : "text-slate-900"}`}>
                            {fmt(week.endCashExpected)}
                        </h3>
                        <p className="text-sm mt-3 leading-relaxed text-slate-500 font-medium">
                            Terminal position for period ending {new Date(week.weekEnd).toLocaleDateString("en-US", { month: 'short', day: 'numeric' })}. 
                            The net movement creates a <span className={`font-bold ${isPositiveWeek ? "text-emerald-700" : "text-rose-600"}`}>{fmt(Math.abs(net))} {isPositiveWeek ? "surplus" : "burn"}</span>.
                        </p>
                    </div>

                    {/* The "Math" (Linear Equation) */}
                    <div className="grid grid-cols-4 gap-0 rounded-2xl border overflow-hidden shadow-sm" style={{ background: "var(--bg-base)", borderColor: "var(--border-subtle)" }}>
                        <div className="p-4 bg-white/50 space-y-1">
                            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Opening</p>
                            <p className="text-sm font-bold font-financial text-slate-900">{fmt(week.startCash)}</p>
                        </div>
                        <div className="p-4 border-l bg-white/30 space-y-1" style={{ borderColor: "var(--border-subtle)" }}>
                            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-emerald-700">Inflows</p>
                            <p className="text-sm font-bold text-emerald-700 font-financial">+{fmt(inflowTotal)}</p>
                        </div>
                        <div className="p-4 border-l bg-white/30 space-y-1" style={{ borderColor: "var(--border-subtle)" }}>
                            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-rose-600">Outflows</p>
                            <p className="text-sm font-bold text-rose-600 font-financial">-{fmt(outflowTotal)}</p>
                        </div>
                        <div className="p-4 border-l bg-slate-50 space-y-1" style={{ borderColor: "var(--border-subtle)" }}>
                            <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Worst-Case</p>
                            <p className="text-sm font-bold font-financial text-slate-900">{fmt(week.endCashWorst)}</p>
                        </div>
                    </div>

                    {week.worstCaseDriver && (
                        <div className="mt-6 flex items-center gap-2 text-[11px] py-1.5 px-3 rounded bg-red-50/50 text-red-700 border border-red-100/50">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>Risk: {week.worstCaseDriver}</span>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ── Runway: distance from buffer + fuel gauge ──────────────────────────
    if (viewMode === "runway") {
        const isBelowBuffer = distFromBuffer < 0;
        return (
            <div className="mx-6 mt-4">
                <div className="rounded-xl px-5 py-5 border shadow-sm" style={{
                    background: isBelowBuffer ? "rgba(220,38,38,0.03)" : "rgba(16,185,129,0.03)",
                    borderColor: isBelowBuffer ? "rgba(220,38,38,0.15)" : "rgba(16,185,129,0.15)"
                }}>
                    <p className="text-[10px] items-center gap-1.5 flex font-bold uppercase tracking-widest mb-4" style={{ color: "var(--text-muted)" }}>
                        <PlaneTakeoff className="w-3.5 h-3.5"/> Buffer Position (Min: {fmt(bufferTarget)})
                    </p>
                    <div className="flex items-end gap-6 mb-4">
                        <div>
                            <p className={`text-3xl font-bold font-financial ${isBelowBuffer ? "text-red-600" : "text-emerald-600"}`}>
                                {distFromBuffer >= 0 ? "+" : "–"}{fmt(Math.abs(distFromBuffer))}
                            </p>
                            <p className="text-[10px] mt-1 font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{isBelowBuffer ? "Below Buffer" : "Surplus Cash"}</p>
                        </div>
                        <div className="flex-1 pb-1">
                            <div className="flex justify-between text-[10px] mb-1.5 font-bold uppercase opacity-60" style={{ color: "var(--text-muted)" }}>
                                <span>Empty</span>
                                <span>{Math.round(fuel * 100)}% tank</span>
                                <span>2× Target</span>
                            </div>
                            <div className="h-3 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
                                <div
                                    className={`h-full rounded-full ${isBelowBuffer ? "bg-red-500" : fuel > 0.6 ? "bg-emerald-500" : "bg-amber-400"}`}
                                    style={{ width: `${Math.max(2, fuel * 100)}%` }}
                                />
                            </div>
                        </div>
                    </div>
                    <p className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
                        {isBelowBuffer
                            ? `You need ${fmt(Math.abs(distFromBuffer))} more to hit your safety minimum.`
                            : `You are ${fmt(distFromBuffer)} above your safety buffer.`
                        }
                    </p>
                </div>
            </div>
        );
    }

    return null;
}


function ReschedulePopover({
    item,
    companyId,
    onSaved,
    onCancel,
}: {
    item: BreakdownItem;
    companyId: string;
    onSaved: () => void;
    onCancel: () => void;
}) {
    const [date, setDate] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const overrideType = item.sourceType === "invoice"
        ? "set_expected_payment_date"
        : "set_bill_due_date";
    const targetType = item.sourceType === "invoice" ? "invoice" : "bill";

    const handleSave = async () => {
        if (!date) { setError("Pick a new date first"); return; }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/overrides", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    type: overrideType,
                    targetType,
                    targetId: item.sourceId,
                    effectiveDate: date,
                }),
            });
            if (!res.ok) { setError("Failed to save — try again"); setSaving(false); return; }
            onSaved();
        } catch {
            setError("Network error");
            setSaving(false);
        }
    };

    return (
        <div className="mt-2 ml-6 rounded-lg p-3 space-y-2 border" style={{ background: "var(--bg-input)", borderColor: "rgba(59,130,246,0.25)" }}>
            <p className="text-xs items-center gap-1.5 flex text-blue-400 font-bold uppercase tracking-widest">
                <Calendar className="w-3.5 h-3.5"/> Move to different week
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Non-destructive override — your original data is unchanged.
            </p>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2 items-center">
                <input
                    type="date"
                    value={date}
                    onChange={e => setDate(e.target.value)}
                    className="flex-1 border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                    style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                />
                <button onClick={handleSave} disabled={saving || !date} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded disabled:opacity-40">
                    {saving ? "Saving…" : "Move"}
                </button>
                <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded border" style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

// ── Recurring Reschedule Popover ─────────────────────────────────────────────
function RecurringReschedulePopover({
    item,
    companyId,
    sourceWeekStart,
    onSaved,
    onCancel,
}: {
    item: BreakdownItem;
    companyId: string;
    sourceWeekStart: string;
    onSaved: () => void;
    onCancel: () => void;
}) {
    const [targetDate, setTargetDate] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (!targetDate) { setError("Pick a target week"); return; }
        setSaving(true);
        setError(null);
        try {
            // Snap the chosen date to the Monday of that week
            const d = new Date(targetDate + "T12:00:00");
            const day = d.getDay();
            const diff = day === 0 ? -6 : 1 - day;
            d.setDate(d.getDate() + diff);
            const targetWeekStart = d.toISOString().slice(0, 10);

            const res = await fetch("/api/recurring-reschedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    patternId: item.sourceId,
                    displayName: item.label,
                    amount: item.amount,
                    sourceWeekStart,
                    targetWeekStart,
                }),
            });
            if (!res.ok) { const j = await res.json(); setError(j.error ?? "Failed to save"); setSaving(false); return; }
            onSaved();
        } catch {
            setError("Network error");
            setSaving(false);
        }
    };

    return (
        <div className="mt-2 ml-6 rounded-lg p-3 space-y-2 border" style={{ background: "var(--bg-input)", borderColor: "rgba(59,130,246,0.25)" }}>
            <p className="text-xs items-center flex gap-1.5 text-blue-400 font-bold uppercase tracking-widest">
                <Calendar className="w-3.5 h-3.5"/> Shift to different week
            </p>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                One-time move — the regular schedule continues unchanged.
            </p>
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2 items-center">
                <input
                    type="date"
                    value={targetDate}
                    onChange={e => setTargetDate(e.target.value)}
                    className="flex-1 border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                    style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                />
                <button onClick={handleSave} disabled={saving || !targetDate} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded disabled:opacity-40">
                    {saving ? "Moving…" : "Move"}
                </button>
                <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded border" style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

// ── Section Block ─────────────────────────────────────────────────────────────
function SectionBlock({
    title, items, sign, companyId, sourceWeekStart, onReschedule, startOpen = false,
}: {
    title: string;
    items: BreakdownItem[];
    sign: "+" | "-";
    companyId: string;
    sourceWeekStart: string;
    onReschedule: () => void;
    startOpen?: boolean;
}) {
    const [reschedulingId, setReschedulingId] = useState<string | null>(null);
    const [resettingId, setResettingId] = useState<string | null>(null);
    // All sections start collapsed by default; caller can override with startOpen
    const [collapsed, setCollapsed] = useState(!startOpen);

    if (items.length === 0) return null;
    const total = items.reduce((s, i) => s + i.amount, 0);
    const deferredCount = items.filter(i => i.type === "rescheduled").length;

    const canReschedule = (item: BreakdownItem) =>
        (item.sourceType === "invoice" || item.sourceType === "bill") && !!item.sourceId;
    const canRescheduleRecurring = (item: BreakdownItem) =>
        item.sourceType === "recurring" && !!item.sourceId && item.type !== "rescheduled";
    const canReset = (item: BreakdownItem) =>
        item.type === "overridden" && !!item.sourceId;

    const handleReset = async (item: BreakdownItem) => {
        if (!item.sourceId) return;
        setResettingId(item.sourceId);
        const overrideType = item.sourceType === "invoice"
            ? "set_expected_payment_date"
            : "set_bill_due_date";
        try {
            await fetch(`/api/overrides?targetId=${item.sourceId}&type=${overrideType}`, {
                method: "DELETE",
            });
            onReschedule();
        } catch {
            // silent fail
        } finally {
            setResettingId(null);
        }
    };

    const handleResetRecurring = async (item: BreakdownItem) => {
        if (!item.sourceId || !item.metadata?.sourceWeekStart) return;
        setResettingId(item.sourceId);
        try {
            // Undo by pattern + the source week it was rescheduled from
            await fetch(`/api/recurring-reschedule?patternId=${item.sourceId}&sourceWeekStart=${item.metadata.sourceWeekStart}`, {
                method: "DELETE",
            });
            onReschedule();
        } catch {
            // silent fail
        } finally {
            setResettingId(null);
        }
    };

    return (
        <div className="mb-4">
            {/* Section header — ALL sections are collapsible */}
            <div
                className="flex items-center justify-between mb-2 cursor-pointer select-none rounded-xl px-3 py-2 -mx-2 hover:bg-slate-50 transition-all group/hdr border border-transparent hover:border-slate-100"
                onClick={() => setCollapsed(c => !c)}
            >
                <div className="flex items-center gap-2.5">
                    <span className="text-[10px] transition-transform duration-300 group-hover/hdr:scale-110" style={{ color: "var(--text-muted)", display: "inline-block", transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>▼</span>
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "var(--text-muted)" }}>{title}</h4>
                    {title === "AP Bills" && (
                        <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-tight px-1.5 border border-indigo-100 rounded-full bg-indigo-50/50 opacity-0 group-hover/hdr:opacity-100 transition-all translate-x-1 group-hover/hdr:translate-x-0">Flexible</span>
                    )}
                    {deferredCount > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-500 font-bold flex items-center gap-1 shadow-sm">
                            <Calendar className="w-2.5 h-2.5" /> {deferredCount} shifted
                        </span>
                    )}
                </div>
                <span className={`text-[11px] font-black font-financial px-2 py-0.5 rounded-lg border ${sign === "+" ? "text-emerald-700 bg-emerald-50 border-emerald-100" : "text-rose-700 bg-rose-50 border-rose-100"}`}>
                    {sign}{fmt(total)}
                </span>
            </div>

            {/* Items — hidden when collapsed */}
            {!collapsed && (
                <div className="space-y-2 mb-4">
                    {items.map((item, i) => (
                        <div key={i} className="group/row stagger-item" style={{ animationDelay: `${i * 40}ms` }}>
                            <div className="flex items-center justify-between py-2.5 px-3.5 rounded-xl gap-2 border bg-white shadow-sm transition-all hover:shadow-md hover:scale-[1.01] hover-elevate" style={{ borderColor: item.type === "rescheduled" ? "rgba(99,102,241,0.25)" : "var(--border-subtle)" }}>
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className={`text-base shrink-0 ${confidenceDot[item.confidence]}`}>•</span>
                                    <div className="min-w-0">
                                        <p className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{item.label}</p>
                                        <div className="flex gap-2 mt-0.5 flex-wrap">
                                            <span className={`text-xs font-medium flex items-center gap-1 ${typeBadge[item.type] ?? ""}`} style={!typeBadge[item.type] ? { color: "var(--text-muted)" } : {}}>
                                                {item.type === "rescheduled" && <Calendar className="w-3 h-3 text-blue-500" />}
                                                {item.type}
                                            </span>
                                            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{item.confidence} confidence</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <span className={`text-sm font-bold font-financial ${sign === "+" ? "text-emerald-600" : "text-red-600"}`}>
                                        {sign}{fmt(item.amount)}
                                    </span>
                                    {(canReset(item) || (item.type === "rescheduled" && !!item.metadata?.sourceWeekStart)) && (
                                        <button
                                            onClick={() => item.type === "rescheduled" ? handleResetRecurring(item) : handleReset(item)}
                                            disabled={resettingId === item.sourceId}
                                            className="text-xs px-1.5 py-0.5 rounded border disabled:opacity-40 flex items-center justify-center min-w-[24px]"
                                            style={{ color: "#f59e0b", borderColor: "rgba(245,158,11,0.25)", background: "rgba(120,53,15,0.10)" }}
                                            title="Reset to original date"
                                        >
                                            {resettingId === item.sourceId ? "…" : <RotateCcw className="w-3 h-3" />}
                                        </button>
                                    )}
                                    {canReschedule(item) && (
                                        <button
                                            onClick={() => setReschedulingId(reschedulingId === item.sourceId ? null : (item.sourceId ?? null))}
                                            className="text-xs px-1.5 py-0.5 rounded border"
                                            style={{ color: "#3b82f6", borderColor: "rgba(59,130,246,0.25)", background: "rgba(59,130,246,0.08)" }}
                                            title="Move to a different week"
                                        >
                                            <Calendar className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                    {canRescheduleRecurring(item) && (
                                        <button
                                            onClick={() => setReschedulingId(reschedulingId === item.sourceId ? null : (item.sourceId ?? null))}
                                            className="text-xs px-2 py-0.5 rounded border font-medium"
                                            style={{ color: "#3b82f6", borderColor: "rgba(59,130,246,0.25)", background: "rgba(59,130,246,0.08)" }}
                                            title="Move this occurrence to another week"
                                        >
                                            <ArrowRight className="w-3.5 h-3.5 mr-0.5" /> Week
                                        </button>
                                    )}
                                </div>
                            </div>
                            {canReschedule(item) && reschedulingId === item.sourceId && (
                                <ReschedulePopover item={item} companyId={companyId} onSaved={() => { setReschedulingId(null); onReschedule(); }} onCancel={() => setReschedulingId(null)} />
                            )}
                            {canRescheduleRecurring(item) && reschedulingId === item.sourceId && (
                                <RecurringReschedulePopover
                                    item={item}
                                    companyId={companyId}
                                    sourceWeekStart={sourceWeekStart}
                                    onSaved={() => { setReschedulingId(null); onReschedule(); }}
                                    onCancel={() => setReschedulingId(null)}
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Zone Labels ──────────────────────────────────────────────────────────────
const zoneLabels: Record<string, { label: string; colorStyle: React.CSSProperties }> = {
    committed: { label: "Committed", colorStyle: { background: "rgba(16,185,129,0.05)", color: "#059669", borderColor: "rgba(16,185,129,0.2)" } },
    pattern: { label: "Bank Pattern", colorStyle: { background: "rgba(37,99,235,0.05)", color: "#2563eb", borderColor: "rgba(37,99,235,0.2)" } },
    uncertain: { label: "Uncertain", colorStyle: { background: "rgba(107,114,128,0.05)", color: "#4b5563", borderColor: "rgba(107,114,128,0.2)" } },
};

// ── Main Modal ───────────────────────────────────────────────────────────────
export function WhyWeekModal({ week, weekNumber, weekStart, companyId, scenarioItems = [], viewMode, buffer, onReschedule, onNavigateWeek, onClose }: Props & { buffer?: number }) {
    const [hoveredSection, setHoveredSection] = useState<string | null>(null);
    const inflowGroups = groupBySection(week.breakdown.inflows);
    const outflowGroups = groupBySection(week.breakdown.outflows);

    // Inject what-if items
    const weekInflows = scenarioItems.filter(s => s.weekNumber === weekNumber && s.direction === "in");
    const weekOutflows = scenarioItems.filter(s => s.weekNumber === weekNumber && s.direction === "out");
    if (weekInflows.length > 0) {
        inflowGroups.set("What-If (Inflows)", weekInflows.map(s => ({
            label: s.label, amount: s.amount,
            type: "scenario", sourceType: "scenario", confidence: "med",
            section: "What-If (Inflows)",
        })));
    }
    if (weekOutflows.length > 0) {
        outflowGroups.set("What-If (Outflows)", weekOutflows.map(s => ({
            label: s.label, amount: s.amount,
            type: "scenario", sourceType: "scenario", confidence: "med",
            section: "What-If (Outflows)",
        })));
    }

    const netExpected = week.endCashExpected - week.startCash;
    const zoneInfo = zoneLabels[week.zone] ?? zoneLabels.uncertain;

    return (
        <div className="fixed inset-0 z-50 flex justify-end p-0 modal-overlay-enter" style={{ background: "rgba(15, 23, 42, 0.4)", backdropFilter: "blur(8px)" }}>
            <div className="border-l h-full w-full max-w-2xl overflow-y-auto drawer-enter shadow-2xl" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>

                {/* Header */}
                <div className="flex items-center justify-between px-8 py-6 border-b sticky top-0 z-10 backdrop-blur-md bg-white/95" style={{ borderColor: "var(--border-subtle)" }}>
                    <div>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] font-black uppercase tracking-[0.2em] px-2.5 py-1 rounded-lg border bg-slate-50 text-slate-500 border-slate-200">Fiscal Week {weekNumber}</span>
                            <span className="w-1 h-1 rounded-full bg-slate-300"></span>
                             <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{new Date(week.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(week.weekEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                        </div>
                        <h2 className="text-xl font-black mt-2 text-slate-900">
                             Week Intelligence
                        </h2>
                    </div>
                    <div className="flex items-center gap-4">
                        {onNavigateWeek && (
                            <div className="flex items-center gap-1 rounded-xl border p-1 bg-slate-50 border-slate-200 shadow-inner">
                                <button onClick={() => onNavigateWeek(-1)} className="p-1.5 hover:bg-white rounded-lg transition-all shadow-sm active:scale-95 text-slate-400 hover:text-slate-900"><ChevronLeft className="w-4 h-4"/></button>
                                <button onClick={() => onNavigateWeek(1)} className="p-1.5 hover:bg-white rounded-lg transition-all shadow-sm active:scale-95 text-slate-400 hover:text-slate-900"><ChevronRight className="w-4 h-4"/></button>
                            </div>
                        )}
                        <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all shadow-sm active:scale-95 text-slate-400 hover:text-slate-900">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Top Action Callout */}
                {(() => {
                    const allInflows = week.breakdown.inflows.filter(i => i.sourceType === "invoice" && i.confidence !== "high");
                    const allBills = week.breakdown.outflows.filter(i => i.sourceType === "bill");
                    const topInflow = allInflows.sort((a, b) => b.amount - a.amount)[0];
                    const topBill = week.endCashExpected < 0 ? allBills.sort((a, b) => b.amount - a.amount)[0] : null;
                    const topAction = topInflow ?? topBill ?? null;
                    if (!topAction) return null;
                    const isCollect = topAction.sourceType === "invoice";
                    return (
                        <div className="mx-6 mt-5 rounded-xl px-4 py-3.5 border shadow-sm" style={{ background: "rgba(79,70,229,0.03)", borderColor: "rgba(79,70,229,0.1)" }}>
                            <p className="text-xs flex items-center gap-1.5 font-bold text-indigo-700 uppercase tracking-widest mb-1.5">
                                <Target className="w-3.5 h-3.5" /> Top Action This Week
                            </p>
                            <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                                {isCollect ? `Collect payment from ${topAction.label}` : `Negotiate delay on ${topAction.label}`}
                            </p>
                            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                                {isCollect
                                    ? `Worth ${fmt(topAction.amount)} · ${topAction.confidence} confidence`
                                    : `Worth ${fmt(topAction.amount)} · pushing gives you breathing room`}
                            </p>
                        </div>
                    );
                })()}

                {/* View-specific hero context - Now contains the summary/risk data */}
                {viewMode && <ViewContextHero week={week} viewMode={viewMode} buffer={buffer} activeSection={hoveredSection} />}

                {/* Zone Indicator (Moved down, less prominent than the outcome) */}
                <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border-subtle)" }}>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Financial Zone</p>
                        <span className="text-[10px] font-bold uppercase tracking-tight px-1.5 py-0.5 rounded border" style={zoneInfo.colorStyle}>
                            {zoneInfo.label}
                        </span>
                    </div>
                    <p className="text-[10px] text-blue-600/70 flex items-center gap-1.5 font-bold uppercase tracking-tight">
                        <Calendar className="w-3 h-3" /> Click items below to reschedule
                    </p>
                </div>

                {/* Inflows */}
                <div 
                    className="px-6 pt-5 transition-colors group/sec" 
                    onMouseEnter={() => setHoveredSection("in")}
                    onMouseLeave={() => setHoveredSection(null)}
                >
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-xs flex items-center gap-1.5 font-bold text-emerald-600 uppercase tracking-widest">
                            <ArrowUpRight className="w-3.5 h-3.5" /> Inflows — <span className="font-financial">{fmt(week.inflowsExpected)}</span> expected
                        </p>
                    </div>
                    {inflowGroups.size === 0 ? (
                        <p className="text-sm mb-4" style={{ color: "var(--text-muted)" }}>No inflows this week</p>
                    ) : (
                        [...inflowGroups.entries()].map(([section, items]) => (
                            <SectionBlock
                                key={section} title={section} items={items} sign="+"
                                companyId={companyId} sourceWeekStart={weekStart} onReschedule={onReschedule}
                                startOpen={section === "AR Receipts" && week.endCashExpected < (buffer ?? 0)}
                            />
                        ))
                    )}
                </div>

                {/* Outflows */}
                <div 
                    className="px-6 pt-2 pb-6 group/sec"
                    onMouseEnter={() => setHoveredSection("out")}
                    onMouseLeave={() => setHoveredSection(null)}
                >
                    <div className="flex items-center justify-between mb-3">
                        <p className="text-xs flex items-center gap-1.5 font-bold text-red-600 uppercase tracking-widest">
                            <ArrowDownRight className="w-3.5 h-3.5" /> Outflows — <span className="font-financial">{fmt(week.outflowsExpected)}</span> expected
                        </p>
                        
                        {/* Composition Pie for Outflows */}
                        <div className="flex items-center gap-2 opacity-0 group-hover/sec:opacity-100 transition-opacity">
                            <div className="text-right">
                                <p className="text-[8px] font-bold uppercase tracking-tight text-red-400">Spending Mix</p>
                                <p className="text-[9px] font-medium text-slate-500">Fixed vs Variable</p>
                            </div>
                            <CategoryDonut items={week.breakdown.outflows} size={32} />
                        </div>
                    </div>
                    {outflowGroups.size === 0 ? (
                        <p className="text-sm" style={{ color: "var(--text-muted)" }}>No outflows this week</p>
                    ) : (
                        [...outflowGroups.entries()].map(([section, items]) => (
                            <SectionBlock
                                key={section} title={section} items={items} sign="-"
                                companyId={companyId} sourceWeekStart={weekStart} onReschedule={onReschedule}
                                startOpen={false}
                            />
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
