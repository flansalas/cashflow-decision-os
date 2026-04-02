// app/recurring/page.tsx — Recurring Commitments dedicated screen
"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
    ArrowLeft, Box, Plus, Pencil, Trash2, Check, Circle, X,
    Calendar, Settings, ChevronDown, ChevronUp, ArrowRight,
    AlertTriangle, Users, Building2, Landmark, Package, Zap,
    Fuel, Wrench, ClipboardList, CreditCard, Pin, Clock,
    ArrowUpRight, ArrowDownLeft, CheckCircle2, RefreshCw,
    GripVertical, TrendingDown, TrendingUp, BarChart3
} from "lucide-react";
import { HelpBubble } from "@/ui/HelpBubble";

// ── Types ──────────────────────────────────────────────────────────────

interface Commitment {
    id: string;
    displayName: string;
    category: string;
    cadence: string;
    nextExpectedDate: string | null;
    typicalAmount: number;
    confidence: string;
    isIncluded: boolean;
    isCritical: boolean;
    direction: string;
}

interface WeekBreakdownItem {
    label: string;
    amount: number;
    type: string;
    sourceType: string;
    sourceId?: string;
    confidence: string;
    section?: string;
}

interface ForecastWeek {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    endCashExpected: number;
    inflowsExpected: number;
    outflowsExpected: number;
    breakdown: {
        outflows: WeekBreakdownItem[];
        inflows: WeekBreakdownItem[];
    };
}

interface DashboardData {
    company: { id: string; name: string };
    commitments: Commitment[];
    commitmentsCount: number;
    forecast: { weeks: ForecastWeek[] };
    assumptions: { bufferMin: number };
    backlog: {
        overdueAP: Array<{ id: string; vendorName: string; billNo: string; amountOpen: number; dueDate: string | null; daysPastDue: number | null; kind: "ap" }>;
        overdueAR: Array<{ id: string; customerName: string; invoiceNo: string; amountOpen: number; dueDate: string | null; daysPastDue: number | null; kind: "ar" }>;
        totalOverdueAP: number;
        totalOverdueAR: number;
    };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0 });
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const categoryIcons: Record<string, React.ReactNode> = {
    payroll: <Users className="w-5 h-5" />, rent: <Building2 className="w-5 h-5" />, loan: <Landmark className="w-5 h-5" />,
    subscription: <Package className="w-5 h-5" />, utilities: <Zap className="w-5 h-5" />, fuel: <Fuel className="w-5 h-5" />,
    materials: <Wrench className="w-5 h-5" />, taxes: <ClipboardList className="w-5 h-5" />,
    card_payment: <CreditCard className="w-5 h-5" />, other: <Pin className="w-5 h-5" />,
};

const CADENCES = ["weekly", "biweekly", "monthly", "irregular"];
const CATEGORIES = ["other", "rent", "loan", "subscription", "utilities", "fuel", "materials", "taxes", "card_payment", "asset_sale"];

interface EditState { amount: string; nextDate: string; displayName: string; }
interface AddState { displayName: string; category: string; cadence: string; amount: string; nextDate: string; isCritical: boolean; direction: string; }
const EMPTY_ADD: AddState = { displayName: "", category: "other", cadence: "monthly", amount: "", nextDate: "", isCritical: false, direction: "outflow" };

// ── Net Balance Impact Bar ──────────────────────────────────────────────

function SurvivalRunway({ weeks, bufferMin }: { weeks: ForecastWeek[], bufferMin: number }) {
    const weeklyData = weeks.map(w => ({
        weekNumber: w.weekNumber,
        weekStart: w.weekStart,
        endCash: w.endCashExpected,
        recurringOut: w.breakdown.outflows.filter(o => o.section === "Recurring Commitments").reduce((s, i) => s + i.amount, 0),
        recurringIn: w.breakdown.inflows.filter(i => i.section === "Recurring Inflows").reduce((s, i) => s + i.amount, 0),
    }));

    const maxCash = Math.max(...weeklyData.map(d => d.endCash), bufferMin * 2, 1);
    const minCash = Math.min(...weeklyData.map(d => d.endCash), 0);
    const range = maxCash - minCash;

    return (
        <div className="rounded-2xl border overflow-hidden shadow-sm transition-shadow hover:shadow-[0_8px_20px_rgba(15,23,42,0.06)]" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
            <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border-subtle)" }}>
                <div className="flex items-center gap-3">
                    <BarChart3 className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-slate-500">
                        13-Week Survival Runway
                    </span>
                    <span className="text-[10px] ml-2 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider border border-amber-200 bg-amber-50 text-amber-700">
                        Buffer: {fmt(bufferMin)}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-red-500 shadow-sm" />
                        <span className="text-[10px] font-bold uppercase tracking-tight" style={{ color: "var(--text-muted)" }}>Danger</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-amber-400 shadow-sm" />
                        <span className="text-[10px] font-bold uppercase tracking-tight" style={{ color: "var(--text-muted)" }}>Below Buffer</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm" />
                        <span className="text-[10px] font-bold uppercase tracking-tight" style={{ color: "var(--text-muted)" }}>Healthy</span>
                    </div>
                </div>
            </div>
            <div className="px-5 pt-12 pb-5 flex gap-2 items-end relative" style={{ minHeight: "180px" }}>
                {/* Risk Zone Backgrounds */}
                <div className="absolute left-0 right-0 z-0 pointer-events-none" 
                    style={{ 
                        bottom: '35px', 
                        height: `${Math.max(((Math.min(bufferMin, maxCash) - minCash) / range) * 90, 0)}%`,
                        background: 'linear-gradient(to top, rgba(239, 68, 68, 0.04) 0%, rgba(245, 158, 11, 0.05) 100%)',
                        borderTop: '1px solid rgba(245, 158, 11, 0.08)' 
                    }} />

                {/* Buffer Line */}
                <div className="absolute left-0 right-0 border-t border-dashed z-20 pointer-events-none" 
                    style={{ 
                        bottom: `${((bufferMin - minCash) / range) * 90 + 35}px`, 
                        borderColor: "rgba(245, 158, 11, 0.4)" 
                    }} />

                {weeklyData.map(d => {
                    const heightPct = Math.max(((d.endCash - minCash) / range) * 90, 2);
                    const isNegative = d.endCash < 0;
                    const isBelowBuffer = d.endCash < bufferMin;
                    
                    let barColor = "var(--color-positive)"; // Sage
                    if (isNegative) barColor = "var(--color-risk-critical)"; // Vibrant Rose
                    else if (isBelowBuffer) barColor = "var(--color-caution)"; // Amber

                    return (
                        <div key={d.weekNumber} className="flex-1 flex flex-col items-center group relative h-full justify-end" title={`W${d.weekNumber}: ${fmt(d.endCash)}`}>
                            {/* Amount Label */}
                            <div className="absolute -top-6 text-center w-full transform -translate-y-1 transition-transform group-hover:-translate-y-2" style={{ bottom: `${heightPct + 35}px` }}>
                                <span className={`text-[9px] font-black whitespace-nowrap px-1 rounded ${isNegative ? "text-red-600 bg-red-50/50" : isBelowBuffer ? "text-amber-600 bg-amber-50/50" : "text-emerald-700 bg-emerald-50/50"}`}>
                                    {fmt(d.endCash)}
                                </span>
                            </div>
                            
                            {/* Bar */}
                            <div className="w-full rounded-t-md transition-all group-hover:brightness-110 shadow-sm" 
                                style={{ height: `${heightPct}%`, background: barColor, minHeight: "4px" }} />
                                
                            {/* Week Label */}
                            <div className="mt-2 text-center pb-1">
                                <span className="text-[10px] font-black uppercase tracking-tighter" style={{ color: "var(--text-muted)" }}>W{d.weekNumber}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Reschedule Inline ───────────────────────────────────────────────────

function WeekRescheduleInline({
    item, companyId, sourceWeekStart, onSaved, onCancel,
}: {
    item: WeekBreakdownItem; companyId: string; sourceWeekStart: string;
    onSaved: () => void; onCancel: () => void;
}) {
    const [targetDate, setTargetDate] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (!targetDate) { setError("Pick a date"); return; }
        setSaving(true);
        setError(null);
        try {
            const d = new Date(targetDate + "T12:00:00");
            const day = d.getDay();
            d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
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
                    direction: item.section === "Recurring Inflows" ? "inflow" : "outflow",
                }),
            });
            if (!res.ok) { const j = await res.json(); setError(j.error ?? "Failed"); setSaving(false); return; }
            onSaved();
        } catch {
            setError("Network error");
            setSaving(false);
        }
    };

    return (
        <div className="mt-2 rounded-2xl p-3 space-y-2.5 border shadow-sm" style={{ background: "var(--bg-input)", borderColor: "rgba(79,70,229,0.2)" }}>
            <p className="text-[10px] items-center gap-1.5 font-bold uppercase tracking-widest flex" style={{ color: "var(--color-primary)" }}>
                <Calendar className="w-3 h-3" /> Shift occurrence to Week
            </p>
            <p className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                One-time move; the regular schedule won&apos;t change.
            </p>
            {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
            <div className="space-y-2">
                <input type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)}
                    className="w-full border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-500 shadow-sm transition-all"
                    style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                <div className="flex gap-2">
                    <button onClick={handleSave} disabled={saving || !targetDate}
                        className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold rounded-lg disabled:opacity-40 transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5">
                        {saving ? <span className="animate-pulse">Moving...</span> : <>Move <ArrowRight className="w-3 h-3" /></>}
                    </button>
                    <button onClick={onCancel}
                        className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors hover:bg-black/5"
                        style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}>
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Schedule Tab ────────────────────────────────────────────────────────

function ScheduleTab({ weeks, companyId, bufferMin, highlightWeek, highlightId, onDismiss, onRescheduled }: {
    weeks: ForecastWeek[]; companyId: string; bufferMin: number; highlightWeek: number | null; 
    highlightId?: string | null; onDismiss?: (id: string) => void; onRescheduled: () => void;
}) {
    const weeksWithRecurring = weeks.filter(w =>
        w.breakdown.outflows.some(o => o.sourceType === "recurring" || o.sourceType === "assumption" || o.section === "Recurring Commitments") ||
        w.breakdown.inflows.some(i => i.sourceType === "recurring" || i.section === "Recurring Inflows")
    );

    if (weeksWithRecurring.length === 0) {
        return (
            <p className="text-sm py-8 px-4 text-center" style={{ color: "var(--text-muted)" }}>
                No recurring items in the 13-week forecast. Add some in the Manage tab.
            </p>
        );
    }

    return (
        <div className="space-y-3 p-5">
            {weeks.map(w => {
                const recurringOutflows = w.breakdown.outflows.filter(o => 
                    o.sourceType === "recurring" || o.sourceType === "assumption" || o.section === "Recurring Commitments"
                );
                const recurringInflows = w.breakdown.inflows.filter(i => 
                    i.sourceType === "recurring" || i.section === "Recurring Inflows"
                );
                const recurringItems = [...recurringInflows, ...recurringOutflows];
                const outTotal = recurringOutflows.reduce((s, i) => s + i.amount, 0);
                const inTotal = recurringInflows.reduce((s, i) => s + i.amount, 0);

                if (recurringItems.length === 0 ) return null;

                const isHighlighted = highlightWeek === w.weekNumber;

                return (
                    <WeekScheduleCard
                        key={w.weekNumber}
                        week={w}
                        recurringItems={recurringItems}
                        outTotal={outTotal}
                        inTotal={inTotal}
                        companyId={companyId}
                        bufferMin={bufferMin}
                        isHighlighted={isHighlighted}
                        highlightId={highlightId}
                        onDismiss={onDismiss}
                        onRescheduled={onRescheduled}
                    />
                );
            })}
        </div>
    );
}

function WeekScheduleCard({ week, recurringItems, outTotal, inTotal, companyId, bufferMin, isHighlighted, highlightId, onDismiss, onRescheduled }: {
    week: ForecastWeek;
    recurringItems: WeekBreakdownItem[];
    outTotal: number;
    inTotal: number;
    companyId: string;
    bufferMin: number;
    isHighlighted: boolean;
    highlightId?: string | null;
    onDismiss?: (id: string) => void;
    onRescheduled: () => void;
}) {
    const [expanded, setExpanded] = useState(isHighlighted);
    const [reschedulingIdx, setReschedulingIdx] = useState<string | null>(null);
    const [dropdownTarget, setDropdownTarget] = useState<{ idx: number; weekNum: string } | null>(null);
    const [ddSaving, setDdSaving] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isHighlighted && cardRef.current) {
            cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
            setExpanded(true);
        }
    }, [isHighlighted]);

    const handleDropdownAssign = async (item: WeekBreakdownItem, targetWeekNum: number) => {
        setDdSaving(true);
        try {
            // Compute target week start from the week number
            const res = await fetch("/api/recurring-reschedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    patternId: item.sourceId,
                    displayName: item.label,
                    amount: item.amount,
                    sourceWeekStart: week.weekStart,
                    targetWeekStart: new Date(new Date(week.weekStart).getTime() + (targetWeekNum - week.weekNumber) * 7 * 86400000).toISOString().slice(0, 10),
                    direction: item.section === "Recurring Inflows" ? "inflow" : "outflow",
                }),
            });
            if (res.ok) {
                setDropdownTarget(null);
                onRescheduled();
            }
        } finally {
            setDdSaving(false);
        }
    };

    const deferredCount = recurringItems.filter(i => i.type === "rescheduled").length;

    return (
        <div
            ref={cardRef}
            className={`rounded-2xl border overflow-hidden transition-all duration-300 ${isHighlighted ? "animate-highlight-flash z-10 relative ring-2 ring-indigo-500/20" : "hover:border-slate-300"}`}
            style={{
                background: "var(--bg-surface)",
                borderColor: isHighlighted ? "rgba(79,70,229,0.5)" : deferredCount > 0 ? "rgba(79,70,229,0.2)" : "var(--border-subtle)",
            }}
        >
            <button onClick={() => setExpanded(e => !e)}
                className="w-full text-left px-5 py-3.5 hover:bg-black/[0.02] transition-colors flex items-center gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Week {week.weekNumber}</span>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>— {fmtDate(week.weekStart)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {deferredCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 flex items-center gap-0.5 rounded font-bold uppercase tracking-tight" style={{ color: "var(--color-primary)", background: "rgba(79,70,229,0.08)" }}>
                                <Calendar className="w-2.5 h-2.5" /> {deferredCount} moved
                            </span>
                        )}
                        <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                            {recurringItems.length} recurring {recurringItems.length === 1 ? 'item' : 'items'}
                        </span>
                    </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right">
                        <div className="flex items-center gap-2 justify-end">
                            <span className="text-[10px] font-bold uppercase tracking-tight" style={{ color: "var(--text-muted)" }}>Projection:</span>
                            <span className={`text-base font-black ${week.endCashExpected < 0 ? "text-red-600" : week.endCashExpected < bufferMin ? "text-amber-600" : "text-emerald-600"}`}>
                                {fmt(week.endCashExpected)}
                            </span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-bold" style={{ color: "var(--text-muted)" }}>
                            {inTotal > 0 && <span className="text-emerald-600">+{fmt(inTotal)}</span>}
                            {outTotal > 0 && <span className="text-red-500">-{fmt(outTotal)}</span>}
                            <span className="uppercase tracking-widest">Recurring Net</span>
                        </div>
                    </div>
                    <ChevronDown className="w-4 h-4 transition-transform" style={{ color: "var(--text-muted)", transform: expanded ? "rotate(180deg)" : "rotate(0)" }} />
                </div>
            </button>

            {expanded && (
                <div className="border-t px-5 py-3 space-y-2" style={{ borderColor: "var(--border-subtle)" }}>
                    {recurringItems.map((item, idx) => (
                        <div key={idx} 
                            onClick={() => { if (highlightId === item.sourceId) onDismiss?.(item.sourceId!); }}
                            className={`rounded-lg border px-3 py-2.5 transition-all cursor-pointer ${highlightId === item.sourceId ? "persistent-focus-glow" : ""}`} 
                            style={{
                                background: "var(--bg-raised)",
                                borderColor: highlightId === item.sourceId ? "rgba(99, 102, 241, 0.4)" : item.type === "rescheduled" ? "rgba(79,70,229,0.15)" : "var(--border-subtle)",
                            }}>
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {item.type === "rescheduled" && <Calendar className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                                    <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{item.label}</span>
                                </div>
                                <span className={`text-sm font-bold shrink-0 ${item.section === "Recurring Inflows" ? "text-emerald-600" : "text-red-600"}`}>
                                    {item.section === "Recurring Inflows" ? "+" : "-"}{fmt(item.amount)}
                                </span>
                            </div>
                            {item.sourceType === "recurring" && item.sourceId && item.type !== "rescheduled" && (
                                <div className="flex gap-2 mt-2">
                                    <button onClick={() => {
                                        setReschedulingIdx(reschedulingIdx === `${idx}` ? null : `${idx}`);
                                        setDropdownTarget(null);
                                    }}
                                        className="text-[11px] px-2 py-1 rounded border font-semibold flex items-center gap-1 transition-colors"
                                        style={{ 
                                            color: reschedulingIdx === `${idx}` ? "var(--color-primary)" : "var(--text-secondary)", 
                                            borderColor: reschedulingIdx === `${idx}` ? "rgba(79,70,229,0.3)" : "var(--border-default)", 
                                            background: reschedulingIdx === `${idx}` ? "rgba(79,70,229,0.05)" : "var(--bg-surface)" 
                                        }}>
                                        <Calendar className="w-3 h-3" /> Move to date
                                    </button>
                                    <div>
                                        <button onClick={() => {
                                            setDropdownTarget(dropdownTarget?.idx === idx ? null : { idx, weekNum: "" });
                                            setReschedulingIdx(null);
                                        }}
                                            className="text-[11px] px-2 py-1 rounded border font-semibold flex items-center gap-1 transition-colors"
                                            style={{ 
                                                color: dropdownTarget?.idx === idx ? "var(--color-primary)" : "var(--text-secondary)", 
                                                borderColor: dropdownTarget?.idx === idx ? "rgba(79,70,229,0.3)" : "var(--border-default)", 
                                                background: dropdownTarget?.idx === idx ? "rgba(79,70,229,0.05)" : "var(--bg-surface)" 
                                            }}>
                                            <ArrowRight className="w-3 h-3" /> Move to week
                                        </button>
                                    </div>
                                </div>
                            )}

                            {dropdownTarget?.idx === idx && (
                                <div className="mt-3 p-3 rounded-lg border bg-white shadow-inner" style={{ borderColor: "rgba(79,70,229,0.15)" }}>
                                    <div className="flex items-center gap-2 mb-2">
                                        <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Pick destination week</span>
                                    </div>
                                    <div className="flex gap-2">
                                        <select value={dropdownTarget.weekNum}
                                            onChange={e => setDropdownTarget({ idx, weekNum: e.target.value })}
                                            className="flex-1 text-xs rounded-lg px-3 py-2 border focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                                            style={{ background: "var(--bg-raised)", color: "var(--text-primary)", borderColor: "var(--border-default)" }}>
                                            <option value="">Select week...</option>
                                            {Array.from({ length: 13 }, (_, i) => i + 1).filter(wn => wn !== week.weekNumber).map(wn => (
                                                <option key={wn} value={wn}>Week {wn}</option>
                                            ))}
                                        </select>
                                        <button onClick={() => dropdownTarget.weekNum && handleDropdownAssign(item, Number(dropdownTarget.weekNum))}
                                            disabled={ddSaving || !dropdownTarget.weekNum}
                                            className="px-4 text-xs rounded-lg font-bold disabled:opacity-40 text-white shadow-sm transition-all hover:brightness-110 active:scale-95 flex items-center gap-2" 
                                            style={{ background: "var(--color-primary)" }}>
                                            {ddSaving ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />} 
                                            Move
                                        </button>
                                        <button onClick={() => setDropdownTarget(null)}
                                            className="px-3 text-xs rounded-lg font-semibold transition-all hover:bg-slate-100" 
                                            style={{ background: "var(--bg-raised)", color: "var(--text-muted)" }}>
                                            Cancel
                                        </button>
                                    </div>
                                    <p className="text-[10px] mt-2 text-slate-400 italic">One-time move: this item will be shifted to the selected week for this 13-week period.</p>
                                </div>
                            )}
                            {reschedulingIdx === `${idx}` && item.sourceId && (
                                <WeekRescheduleInline item={item} companyId={companyId} sourceWeekStart={week.weekStart}
                                    onSaved={() => { setReschedulingIdx(null); onRescheduled(); }}
                                    onCancel={() => setReschedulingIdx(null)} />
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function CommitmentRow({ c, highlightId, editingId, editState, saving, setEditingId, setEditState, handleDelete, patch, onDismiss }: {
    c: Commitment; highlightId?: string | null; editingId: string | null; editState: EditState; saving: string | null;
    setEditingId: (id: string | null) => void; setEditState: (s: EditState) => void;
    handleDelete: (c: Commitment) => void; patch: (id: string, body: any) => Promise<boolean>;
    onDismiss?: (id: string) => void;
}) {
    const rowRef = useRef<HTMLDivElement>(null);
    const isEditing = editingId === c.id;
    const isHighlighted = highlightId === c.id;

    useEffect(() => {
        if (isHighlighted && rowRef.current) {
            rowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [isHighlighted]);

    return (
        <div 
            ref={rowRef}
            onClick={() => { if (isHighlighted) onDismiss?.(c.id); }}
            className={`py-4 border-t first:border-t-0 px-4 -mx-2 rounded-2xl group transition-all duration-200 ${!c.isIncluded ? "opacity-30 grayscale" : "hover:bg-slate-50"} ${isHighlighted ? "persistent-focus-glow bg-indigo-50/30" : ""}`} 
            style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center gap-3">
                <span className="text-lg shrink-0 flex items-center justify-center w-10 h-10 rounded-xl border shadow-sm transition-transform group-hover:scale-105" style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}>
                    {categoryIcons[c.category] || <Pin className="w-5 h-5 text-slate-400" />}
                </span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{c.displayName}</span>
                        {c.direction === "inflow" && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-100 font-semibold">Inflow</span>
                        )}
                        {c.isCritical && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-700 rounded border border-red-100 font-semibold">Critical</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2 text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                        <span className="capitalize">{c.cadence === "irregular" ? "one-time" : c.cadence}</span>
                        <span>·</span>
                        <span>Next: {c.nextExpectedDate ? new Date(c.nextExpectedDate).toLocaleDateString() : "TBD"}</span>
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <p className={`text-sm font-bold font-financial ${c.direction === "inflow" ? "text-emerald-600" : ""}`} style={c.direction !== "inflow" ? { color: "var(--text-primary)" } : {}}>
                        {c.direction === "inflow" ? "+" : ""}{fmt(c.typicalAmount)}
                    </p>
                </div>
            </div>

            {isEditing && (
                <div className="mt-3 border rounded-lg p-3 space-y-2" style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)" }}>
                    <div className="space-y-3">
                        <div>
                            <label className="text-xs block mb-1 uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>Name</label>
                            <input type="text" value={editState.displayName} onChange={e => setEditState({ ...editState, displayName: e.target.value })}
                                className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} placeholder="e.g. Rent, Payroll" />
                        </div>
                        <div className="flex gap-3">
                            <div className="flex-1">
                                <label className="text-xs block mb-1 uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>Amount ($)</label>
                                <input type="number" value={editState.amount} onChange={e => setEditState({ ...editState, amount: e.target.value })}
                                    className="w-full border rounded px-3 py-1.5 text-sm font-financial font-bold focus:outline-none focus:border-blue-500"
                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} min={0} step={100} />
                            </div>
                            <div className="flex-1">
                                <label className="text-xs block mb-1 uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>Next Date</label>
                                <input type="date" value={editState.nextDate} onChange={e => setEditState({ ...editState, nextDate: e.target.value })}
                                    className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button onClick={async () => {
                            const amount = parseFloat(editState.amount);
                            const ok = await patch(c.id, { 
                                displayName: editState.displayName.trim(),
                                typicalAmount: amount, 
                                nextExpectedDate: editState.nextDate || null 
                            });
                            if (ok) setEditingId(null);
                        }} disabled={saving === c.id}
                            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded font-semibold disabled:opacity-40 shadow-sm transition-colors">
                            {saving === c.id ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => handleDelete(c)} disabled={saving === c.id} className="px-3 py-1.5 text-red-700 text-xs rounded border border-red-100 disabled:opacity-40 hover:bg-red-50 transition-colors shadow-sm" style={{ background: "var(--bg-surface)" }}>Delete</button>
                        <button onClick={() => { setEditingId(null); }} className="px-3 py-1.5 text-xs rounded border hover:bg-black/5 transition-colors" style={{ color: "var(--text-muted)", background: "var(--bg-raised)", borderColor: "var(--border-default)" }}>Cancel</button>
                    </div>
                </div>
            )}

            <div className="flex items-center gap-2 mt-2">
                <button onClick={() => patch(c.id, { isIncluded: !c.isIncluded })} disabled={saving === c.id}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border disabled:opacity-40 transition-all shadow-sm ${c.isIncluded ? "border-slate-300 text-slate-700 bg-slate-50" : "border-slate-200 text-slate-500 bg-slate-50"}`}>
                    <span>{c.isIncluded ? <Check className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}</span>
                    <span>{c.isIncluded ? "In Forecast" : "Excluded"}</span>
                </button>
                <button onClick={() => patch(c.id, { isCritical: !c.isCritical })} disabled={saving === c.id}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border disabled:opacity-40 transition-all shadow-sm ${c.isCritical ? "border-red-200 text-red-700 bg-red-50" : "border-gray-200 text-gray-500 bg-gray-50"}`}>
                    <span>{c.isCritical ? <Circle className="w-3.5 h-3.5 fill-current text-red-600" /> : <Circle className="w-3.5 h-3.5 text-gray-400" />}</span>
                    <span>Critical</span>
                </button>
                {!isEditing && (
                    <button onClick={() => { 
                        setEditingId(c.id); 
                        setEditState({ 
                            displayName: c.displayName,
                            amount: String(c.typicalAmount), 
                            nextDate: c.nextExpectedDate ? new Date(c.nextExpectedDate).toISOString().slice(0, 10) : "" 
                        }); 
                    }}
                        className="px-2 py-1 rounded text-xs border ml-auto" style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}>
                        <Pencil className="w-3 h-3 inline-block mr-1" /> Edit
                    </button>
                )}
            </div>
        </div>
    );
}

function ManageTab({ commitments, companyId, onChanged, highlightId, onDismiss, showAddForm, setShowAddForm }: {
    commitments: Commitment[]; companyId: string; onChanged?: () => void; highlightId?: string | null; onDismiss?: (id: string) => void;
    showAddForm: boolean; setShowAddForm: (show: boolean) => void;
}) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editState, setEditState] = useState<EditState>({ amount: "", nextDate: "", displayName: "" });
    const [saving, setSaving] = useState<string | null>(null);
    const [localCommitments, setLocalCommitments] = useState<Commitment[]>(commitments);
    const [error, setError] = useState<string | null>(null);
    const [addState, setAddState] = useState<AddState>(EMPTY_ADD);
    const [addSaving, setAddSaving] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);

    useEffect(() => {
        if (editingId === null) setLocalCommitments(commitments);
    }, [commitments, editingId]);

    const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
        setSaving(id);
        setError(null);
        try {
            const res = await fetch(`/api/commitments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            if (!res.ok) { const err = await res.json(); setError(err.error ?? "Save failed"); return false; }
            const updated = await res.json();
            setLocalCommitments(prev => prev.map(c => c.id === id ? { ...c, ...updated } : c));
            onChanged?.();
            return true;
        } catch {
            setError("Network error — try again");
            return false;
        } finally {
            setSaving(null);
        }
    }, [onChanged]);

    const handleDelete = async (c: Commitment) => {
        if (!confirm(`Delete "${c.displayName}" permanently?`)) return;
        setSaving(c.id);
        try {
            const res = await fetch(`/api/commitments/${c.id}`, { method: "DELETE" });
            if (!res.ok) { setError("Failed to delete"); return; }
            setLocalCommitments(prev => prev.filter(x => x.id !== c.id));
            setEditingId(null);
            onChanged?.();
        } catch {
            setError("Network error — try again");
        } finally {
            setSaving(null);
        }
    };

    const handleAddCommitment = async () => {
        setAddError(null);
        const amount = parseFloat(addState.amount);
        if (!addState.displayName.trim()) { setAddError("Name is required"); return; }
        if (isNaN(amount) || amount <= 0) { setAddError("Amount must be positive"); return; }
        if (!addState.nextDate) { setAddError("Next date is required"); return; }

        setAddSaving(true);
        try {
            const res = await fetch("/api/commitments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, displayName: addState.displayName.trim(), category: addState.category, cadence: addState.cadence, typicalAmount: amount, nextExpectedDate: addState.nextDate, isCritical: addState.isCritical, direction: addState.direction }),
            });
            const data = await res.json();
            if (!res.ok) { setAddError(data.error ?? "Failed to add"); return; }
            setLocalCommitments(prev => [...prev, { ...data, direction: addState.direction }]);
            setAddState(EMPTY_ADD);
            setShowAddForm(false);
            onChanged?.();
        } catch {
            setAddError("Network error — try again");
        } finally {
            setAddSaving(false);
        }
    };

    const sortedCommitments = [...localCommitments].sort((a, b) => {
        const aIsPayroll = a.category === "payroll" || a.displayName.toLowerCase().includes("payroll");
        const bIsPayroll = b.category === "payroll" || b.displayName.toLowerCase().includes("payroll");
        if (aIsPayroll && !bIsPayroll) return -1;
        if (!aIsPayroll && bIsPayroll) return 1;
        return 0;
    });

    return (
        <div className="p-5 space-y-1">
            {error && (
                <div className="text-xs text-red-700 border border-red-200 rounded px-3 py-2 mb-2 font-medium" style={{ background: "rgba(220,38,38,0.03)" }}>
                    {error}
                </div>
            )}

            {showAddForm && (
                <div className="border-b pb-5 mb-3 mt-1" style={{ borderColor: "var(--border-subtle)" }}>
                    <p className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-1.5" style={{ color: "var(--color-primary)" }}>
                        <Plus className="w-4 h-4" /> New Recurring Event
                    </p>
                    {addError && (
                        <div className="text-xs text-red-700 border border-red-200 rounded px-3 py-2 mb-3 font-medium" style={{ background: "rgba(220,38,38,0.03)" }}>{addError}</div>
                    )}
                    <div className="space-y-2">
                        <input type="text" value={addState.displayName} onChange={e => setAddState(s => ({ ...s, displayName: e.target.value }))}
                            placeholder="Name (e.g. Office Rent, Insurance)"
                            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 shadow-sm"
                            style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                        <div className="grid grid-cols-2 gap-2">
                            <input type="number" value={addState.amount} onChange={e => setAddState(s => ({ ...s, amount: e.target.value }))}
                                placeholder="Amount ($)" min={0}
                                className="border rounded-lg px-3 py-2 text-sm font-financial font-bold focus:outline-none focus:border-blue-500 shadow-sm"
                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                            <input type="date" value={addState.nextDate} onChange={e => setAddState(s => ({ ...s, nextDate: e.target.value }))}
                                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 shadow-sm"
                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <select value={addState.direction} onChange={e => setAddState(s => ({ ...s, direction: e.target.value }))}
                                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 shadow-sm"
                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                <option value="outflow">Money Out (Expense)</option>
                                <option value="inflow">Money In (Revenue)</option>
                            </select>
                            <select value={addState.cadence} onChange={e => setAddState(s => ({ ...s, cadence: e.target.value }))}
                                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 shadow-sm"
                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                {CADENCES.map(c => <option key={c} value={c}>{c === "irregular" ? "one-time" : c}</option>)}
                            </select>
                            <select value={addState.category} onChange={e => setAddState(s => ({ ...s, category: e.target.value }))}
                                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 shadow-sm col-span-2"
                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <button onClick={() => setAddState(s => ({ ...s, isCritical: !s.isCritical }))}
                            className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded border ${addState.isCritical ? "border-red-200 text-red-800 bg-red-50" : "border-gray-200 text-gray-500 bg-gray-50"}`}>
                            {addState.isCritical ? <><AlertTriangle className="w-3 h-3 inline-block mr-1" /> Critical — click to unmark</> : <><Circle className="w-3 h-3 inline-block mr-1" /> Mark as critical</>}
                        </button>
                        <div className="flex gap-2 pt-1">
                            <button onClick={handleAddCommitment} disabled={addSaving} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg disabled:opacity-40 shadow-sm flex items-center justify-center gap-1.5">
                                {addSaving ? "Saving…" : <><CheckCircle2 className="w-4 h-4" /> Add to Forecast</>}
                            </button>
                            <button onClick={() => { setShowAddForm(false); setAddState(EMPTY_ADD); setAddError(null); }}
                                className="px-4 py-2 text-sm rounded-lg border"
                                style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {sortedCommitments.length === 0 ? (
                <p className="text-sm py-4" style={{ color: "var(--text-muted)" }}>No planned events yet.</p>
            ) : (
                sortedCommitments.map(c => (
                    <CommitmentRow 
                        key={c.id} 
                        c={c} 
                        highlightId={highlightId} 
                        editingId={editingId}
                        editState={editState}
                        saving={saving}
                        setEditingId={setEditingId}
                        setEditState={setEditState}
                        handleDelete={handleDelete}
                        patch={patch}
                        onDismiss={onDismiss}
                    />
                ))
            )}

            {!showAddForm && (
                <button onClick={() => {
                    setShowAddForm(true);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                    className="w-full mt-3 py-2.5 text-xs border border-dashed rounded-lg focus:outline-none transition-colors hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/50 flex items-center justify-center gap-1.5"
                    style={{ color: "var(--text-muted)", borderColor: "var(--border-default)" }}>
                    <Plus className="w-3.5 h-3.5" /> Add recurring event
                </button>
            )}
        </div>
    );
}

// ── Main Page ───────────────────────────────────────────────────────────

function RecurringContent() {
    const searchParams = useSearchParams();
    const highlightWeek = searchParams.get("highlightWeek") ? Number(searchParams.get("highlightWeek")) : null;
    const highlightId = searchParams.get("highlightId");
    const companyId = searchParams.get("companyId") ?? (typeof window !== "undefined" ? localStorage.getItem("cfdo_company_id") : null);

    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<"schedule" | "manage">("schedule");
    const [showAddForm, setShowAddForm] = useState(false);
    const [dismissedHighlights, setDismissedHighlights] = useState<Set<string>>(new Set());

    const handleDismiss = useCallback((id: string) => {
        setDismissedHighlights(prev => {
            const next = new Set(prev);
            next.add(id);
            return next;
        });
    }, []);

    const fetchData = useCallback(() => {
        const url = companyId ? `/api/dashboard?companyId=${companyId}` : "/api/dashboard";
        setLoading(true);
        fetch(url)
            .then(r => r.json())
            .then(d => {
                if (d.error) setError(d.error);
                else { setData(d); setError(null); }
            })
            .catch(() => setError("Failed to load"))
            .finally(() => setLoading(false));
    }, [companyId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Auto-switch to Manage if highlighting a specific commitment pattern
    useEffect(() => {
        if (highlightId && data?.commitments.some(c => c.id === highlightId)) {
            setTab("manage");
        }
    }, [highlightId, data?.commitments]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="text-center space-y-4">
                    <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full mx-auto" />
                    <p className="text-sm tracking-wide" style={{ color: "var(--text-muted)" }}>Loading recurring commitments…</p>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="border rounded-xl p-8 max-w-md text-center" style={{ background: '#fff5f5', borderColor: 'rgba(220,38,38,0.25)' }}>
                    <p style={{ color: '#dc2626' }} className="text-base font-medium mb-3 flex items-center justify-center gap-2">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" /> {error}
                    </p>
                    <a href="/dashboard" style={{ color: 'var(--color-primary)' }} className="hover:underline text-sm flex items-center justify-center gap-1">
                        <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
            {/* Header */}
            <header className="border-b sticky top-0 z-50 backdrop-blur-md" style={{ background: "rgba(255,255,255,0.92)", borderColor: "var(--border-subtle)", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <a href="/dashboard" className="text-xs font-medium flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                            <ArrowLeft className="w-3 h-3" /> Dashboard
                        </a>
                        <span style={{ color: "var(--border-default)" }}>/</span>
                        <span style={{ color: "var(--color-primary)" }} className="font-bold text-sm flex items-center gap-1.5"><Calendar className="w-4 h-4" /> Recurring Commitments</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                setTab("manage");
                                setShowAddForm(true);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                            className="px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider rounded-lg shadow-sm transition-all"
                            style={{ background: "var(--color-primary)", color: "white" }}
                        >
                            <Plus className="w-3.5 h-3.5" /> Add Commitment
                        </button>
                        <button onClick={fetchData} className="p-1.5 rounded-lg border text-sm" title="Refresh" style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-muted)" }}>
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-5 py-6 space-y-5">
                {/* Survival Runway */}
                <SurvivalRunway weeks={data.forecast.weeks} bufferMin={data.assumptions.bufferMin} />

                {/* Tab Switcher */}
                <div className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                    <div className="flex border-b" style={{ borderColor: "var(--border-subtle)" }}>
                        {([
                            { id: "schedule" as const, icon: <Calendar className="w-4 h-4" />, label: "Schedule" },
                            { id: "manage" as const, icon: <Settings className="w-4 h-4" />, label: "Manage" },
                        ]).map(t => (
                            <button key={t.id} onClick={() => setTab(t.id)}
                                className="flex-1 py-3 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                                style={tab === t.id
                                    ? { color: "var(--color-primary)", borderBottom: "2px solid var(--color-primary)" }
                                    : { color: "var(--text-muted)", borderBottom: "2px solid transparent" }}>
                                {t.icon} {t.label}
                            </button>
                        ))}
                    </div>

                    {tab === "schedule" ? (
                        <ScheduleTab
                            weeks={data.forecast.weeks}
                            companyId={data.company.id}
                            bufferMin={data.assumptions.bufferMin}
                            highlightWeek={highlightWeek}
                            highlightId={dismissedHighlights.has(highlightId ?? "") ? null : highlightId}
                            onDismiss={handleDismiss}
                            onRescheduled={fetchData}
                        />
                    ) : (
                        <ManageTab
                            commitments={data.commitments}
                            companyId={data.company.id}
                            highlightId={dismissedHighlights.has(highlightId ?? "") ? null : highlightId}
                            onDismiss={handleDismiss}
                            onChanged={fetchData}
                            showAddForm={showAddForm}
                            setShowAddForm={setShowAddForm}
                        />
                    )}
                </div>
            </main>
        </div>
    );
}

export default function RecurringPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full" />
            </div>
        }>
            <RecurringContent />
        </Suspense>
    );
}
