"use client";

import { useState, useMemo } from "react";
import { ArrowRight, BarChart2, CornerDownRight, ChevronDown, ChevronRight } from "lucide-react";

interface ForecastSummaryGridProps {
    forecast: any; // ForecastResult
    categories: any[]; // CashFlowCategory array
    onCellClick?: (type: string, week: number, extraId?: string) => void;
}

function fmt(n: number) {
    if (!n) return "$0";
    return "$" + Math.round(n).toLocaleString("en-US");
}

function formatDateRange(start: string | Date, end: string | Date) {
    const s = new Date(start);
    const e = new Date(end);
    return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${e.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

interface HoveredInfo {
    type: "in" | "out";
    week: number;
    scheduled: number;
    recurring: number;
    projected: number;
    total: number;
    weekLabel: string;
}

export function ForecastSummaryGrid({ forecast, categories, onCellClick }: ForecastSummaryGridProps) {
    const weeks = useMemo(() => forecast?.weeks || [], [forecast]);
    const [inflowsExpanded, setInflowsExpanded] = useState(true);
    const [outflowsExpanded, setOutflowsExpanded] = useState(true);
    const [hoveredInfo, setHoveredInfo] = useState<HoveredInfo | null>(null);

    if (!weeks.length) return null;

    // Helper to render a clickable cell amount
    const renderCell = (amount: number, type: string, weekNum: number, extraId?: string) => {
        const isInteractive = onCellClick && !!type;
        return (
            <td key={weekNum}
                className={`px-3 py-2.5 text-right text-xs border-r border-b transition-all duration-200 ${isInteractive ? "hover:bg-slate-900/5 hover:text-slate-900 cursor-pointer font-bold" : ""}`}
                style={{ borderColor: "var(--border-subtle)" }}
                onClick={() => { if (isInteractive) onCellClick(type, weekNum, extraId); }}
                title={isInteractive ? "Click to manage items" : undefined}
            >
                {amount === 0
                    ? <span style={{ color: "var(--text-muted)", opacity: 0.3 }}>—</span>
                    : <span className="font-financial tracking-tight font-medium">{fmt(amount)}</span>}
            </td>
        );
    };

    const inCategories = categories.filter(c => c.direction === "inflow");
    const outCategories = categories.filter(c => c.direction === "outflow");

    return (
        <div className="rounded-xl border overflow-hidden mt-6 mb-8" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
            <div className="px-5 py-3 border-b flex items-center justify-between" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                <div className="flex items-center gap-2">
                    <BarChart2 className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
                    <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>13-Week Cash Summary</h3>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[1000px]">
                    <thead>
                        <tr style={{ background: "var(--bg-base)" }}>
                            <th className="px-5 py-3 border-b border-r sticky left-0 z-10 font-bold text-[10px] uppercase tracking-[0.2em] w-[200px]"
                                style={{ background: "var(--bg-base)", borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}>
                                Week Timeline
                            </th>
                            {weeks.map((w: any) => (
                                <th key={w.weekNumber} className="px-3 py-2 border-b border-r text-right font-medium text-[10px] leading-tight"
                                    style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}>
                                    <div className="font-bold text-xs" style={{ color: "var(--text-primary)" }}>W{w.weekNumber}</div>
                                    {formatDateRange(w.weekStart, w.weekEnd)}
                                </th>
                            ))}
                        </tr>
                        <tr>
                            <th className="px-5 py-4 border-b border-r sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)]"
                                style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-primary)" }}>Final Cash Balance</span>
                            </th>
                            {weeks.map((w: any) => (
                                <th key={w.weekNumber} className="px-3 py-4 border-b border-r text-right"
                                    style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                                    <span className={`text-sm font-bold font-financial tracking-tight ${w.endCashExpected < 0 ? "text-rose-600" : "text-emerald-700"}`}>
                                        {fmt(w.endCashExpected)}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody style={{ color: "var(--text-primary)" }}>

                        {/* ── INFLOWS HEADER ROW ── */}
                        <tr
                            className="cursor-pointer hover:bg-black/5 transition-colors"
                            onClick={() => setInflowsExpanded(!inflowsExpanded)}
                            style={{ background: "var(--bg-base)" }}
                        >
                            <td className="px-4 py-2 border-b border-r sticky left-0 z-10 font-bold text-xs uppercase tracking-wide flex items-center gap-2 w-[180px]"
                                style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)", background: "var(--bg-base)" }}>
                                {inflowsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                Cash In
                            </td>
                            {weeks.map((w: any) => {
                                const scheduled = w.breakdown.inflows.filter((i: any) => i.sourceType === "invoice").reduce((s: number, i: any) => s + i.amount, 0);
                                const recurring = w.breakdown.inflows.filter((i: any) => i.sourceType === "recurring").reduce((s: number, i: any) => s + i.amount, 0);
                                const projected = Math.max(0, w.inflowsExpected - scheduled - recurring);
                                return (
                                    <td
                                        key={w.weekNumber}
                                        className="px-3 py-2 border-b border-r text-right text-xs font-bold cursor-default transition-colors"
                                        style={{
                                            borderColor: "var(--border-subtle)",
                                            background: hoveredInfo?.type === "in" && hoveredInfo.week === w.weekNumber
                                                ? "rgba(5,150,105,0.06)" : "var(--bg-base)"
                                        }}
                                        onMouseEnter={() => setHoveredInfo({
                                            type: "in", week: w.weekNumber,
                                            scheduled, recurring, projected,
                                            total: w.inflowsExpected,
                                            weekLabel: `W${w.weekNumber} · ${formatDateRange(w.weekStart, w.weekEnd)}`
                                        })}
                                        onMouseLeave={() => setHoveredInfo(null)}
                                    >
                                        <span className="text-emerald-700">{fmt(w.inflowsExpected)}</span>
                                    </td>
                                );
                            })}
                        </tr>
                        {inflowsExpanded && (
                            <>
                                <tr className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                    <td className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs font-semibold flex items-center gap-2 w-[180px]"
                                        style={{ background: "inherit", borderColor: "var(--border-subtle)" }}>
                                        <CornerDownRight className="w-3.5 h-3.5 text-emerald-500" /> AR Receipts
                                    </td>
                                    {weeks.map((w: any) => {
                                        const amount = w.breakdown.inflows.filter((i: any) => i.sourceType === "invoice").reduce((s: number, i: any) => s + i.amount, 0);
                                        return renderCell(amount, "ar", w.weekNumber);
                                    })}
                                </tr>
                                {inCategories.map(cat => (
                                    <tr key={cat.id} className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                        <td className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs flex items-center gap-2 w-[180px]"
                                            style={{ background: "inherit", borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}>
                                            <div className="w-3.5" /> <span className="truncate">{cat.name}</span>
                                        </td>
                                        {weeks.map((w: any) => {
                                            const amount = w.breakdown.inflows.filter((i: any) => i.section === `Cat: ${cat.name}`).reduce((s: number, i: any) => s + i.amount, 0);
                                            return renderCell(amount, "cash-adjustments", w.weekNumber, cat.id);
                                        })}
                                    </tr>
                                ))}
                                <tr className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                    <td className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs flex items-center gap-2 w-[180px]"
                                        style={{ background: "inherit", borderColor: "var(--border-subtle)" }}>
                                        <div className="w-3.5" /> Recurring Inflows
                                    </td>
                                    {weeks.map((w: any) => {
                                        const amount = w.breakdown.inflows.filter((i: any) => i.sourceType === "recurring").reduce((s: number, i: any) => s + i.amount, 0);
                                        return renderCell(amount, "recurring-in", w.weekNumber);
                                    })}
                                </tr>
                            </>
                        )}

                        {/* ── OUTFLOWS HEADER ROW ── */}
                        <tr
                            className="cursor-pointer hover:bg-black/5 transition-colors"
                            onClick={() => setOutflowsExpanded(!outflowsExpanded)}
                            style={{ background: "var(--bg-base)" }}
                        >
                            <td className="px-4 py-2 border-b border-r sticky left-0 z-10 font-bold text-xs uppercase tracking-wide flex items-center gap-2 w-[180px]"
                                style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)", background: "var(--bg-base)" }}>
                                {outflowsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                Cash Out
                            </td>
                            {weeks.map((w: any) => {
                                const scheduled = w.breakdown.outflows.filter((i: any) => i.sourceType === "bill").reduce((s: number, i: any) => s + i.amount, 0);
                                const recurring = w.breakdown.outflows.filter((i: any) => i.sourceType === "recurring").reduce((s: number, i: any) => s + i.amount, 0);
                                const projected = Math.max(0, w.outflowsExpected - scheduled - recurring);
                                return (
                                    <td
                                        key={w.weekNumber}
                                        className="px-3 py-2 border-b border-r text-right text-xs font-bold cursor-default transition-colors"
                                        style={{
                                            borderColor: "var(--border-subtle)",
                                            background: hoveredInfo?.type === "out" && hoveredInfo.week === w.weekNumber
                                                ? "rgba(225,29,72,0.05)" : "var(--bg-base)"
                                        }}
                                        onMouseEnter={() => setHoveredInfo({
                                            type: "out", week: w.weekNumber,
                                            scheduled, recurring, projected,
                                            total: w.outflowsExpected,
                                            weekLabel: `W${w.weekNumber} · ${formatDateRange(w.weekStart, w.weekEnd)}`
                                        })}
                                        onMouseLeave={() => setHoveredInfo(null)}
                                    >
                                        <span className="text-red-700">{fmt(w.outflowsExpected)}</span>
                                    </td>
                                );
                            })}
                        </tr>
                        {outflowsExpanded && (
                            <>
                                <tr className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                    <td className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs font-semibold flex items-center gap-2 w-[180px]"
                                        style={{ background: "inherit", borderColor: "var(--border-subtle)" }}>
                                        <CornerDownRight className="w-3.5 h-3.5 text-red-500" /> AP Bills
                                    </td>
                                    {weeks.map((w: any) => {
                                        const amount = w.breakdown.outflows.filter((i: any) => i.sourceType === "bill").reduce((s: number, i: any) => s + i.amount, 0);
                                        return renderCell(amount, "ap", w.weekNumber);
                                    })}
                                </tr>
                                <tr className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                    <td className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs font-semibold flex items-center gap-2 w-[180px]"
                                        style={{ background: "inherit", borderColor: "var(--border-subtle)" }}>
                                        <div className="w-3.5" /> Payroll
                                    </td>
                                    {weeks.map((w: any) => {
                                        const amount = w.breakdown.outflows.filter((i: any) => i.label?.toLowerCase().includes("payroll")).reduce((s: number, i: any) => s + i.amount, 0);
                                        return renderCell(amount, "recurring-payroll", w.weekNumber);
                                    })}
                                </tr>
                                <tr className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                    <td className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs flex items-center gap-2 w-[180px]"
                                        style={{ background: "inherit", borderColor: "var(--border-subtle)" }}>
                                        <div className="w-3.5" /> Recurring Expenses
                                    </td>
                                    {weeks.map((w: any) => {
                                        const amount = w.breakdown.outflows.filter((i: any) => i.sourceType === "recurring" && !i.label?.toLowerCase().includes("payroll")).reduce((s: number, i: any) => s + i.amount, 0);
                                        return renderCell(amount, "recurring", w.weekNumber);
                                    })}
                                </tr>
                                {outCategories.map(cat => (
                                    <tr key={cat.id} className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                        <td className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs flex items-center gap-2 w-[180px]"
                                            style={{ background: "inherit", borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}>
                                            <div className="w-3.5" /> <span className="truncate">{cat.name}</span>
                                        </td>
                                        {weeks.map((w: any) => {
                                            const amount = w.breakdown.outflows.filter((i: any) => i.section === `Cat: ${cat.name}`).reduce((s: number, i: any) => s + i.amount, 0);
                                            return renderCell(amount, "cash-adjustments", w.weekNumber, cat.id);
                                        })}
                                    </tr>
                                ))}
                            </>
                        )}

                    </tbody>
                </table>
            </div>

            {/* ── Hover composition bar ── */}
            <div
                className="px-5 border-t transition-all duration-200 overflow-hidden"
                style={{
                    borderColor: "var(--border-subtle)",
                    background: hoveredInfo
                        ? hoveredInfo.type === "in" ? "rgba(5,150,105,0.04)" : "rgba(225,29,72,0.04)"
                        : "var(--bg-raised)",
                    maxHeight: hoveredInfo ? "80px" : "38px",
                }}
            >
                {hoveredInfo ? (
                    <div className="py-3 flex items-center gap-6 flex-wrap">
                        <span className="text-[9px] font-black uppercase tracking-widest shrink-0" style={{ color: "var(--text-muted)" }}>
                            {hoveredInfo.weekLabel} · {hoveredInfo.type === "in" ? "Inflow" : "Outflow"} Breakdown
                        </span>
                        <div className="flex items-center gap-5 flex-wrap">
                            {hoveredInfo.type === "in" ? (
                                <>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Scheduled AR</span>
                                        <span className="text-[10px] font-bold text-emerald-700">{fmt(hoveredInfo.scheduled)}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-300 shrink-0" />
                                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Recurring</span>
                                        <span className="text-[10px] font-bold text-emerald-600">{fmt(hoveredInfo.recurring)}</span>
                                    </div>
                                    {hoveredInfo.projected > 0 && (
                                        <div className="flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                                            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Projected Collections</span>
                                            <span className="text-[10px] font-bold text-slate-500">{fmt(hoveredInfo.projected)}</span>
                                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 whitespace-nowrap">⚙ engine est. · 90-day avg</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Scheduled AP</span>
                                        <span className="text-[10px] font-bold text-rose-700">{fmt(hoveredInfo.scheduled)}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-300 shrink-0" />
                                        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Recurring</span>
                                        <span className="text-[10px] font-bold text-rose-600">{fmt(hoveredInfo.recurring)}</span>
                                    </div>
                                    {hoveredInfo.projected > 0 && (
                                        <div className="flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                                            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>Projected Variable Spend</span>
                                            <span className="text-[10px] font-bold text-slate-500">{fmt(hoveredInfo.projected)}</span>
                                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 whitespace-nowrap">⚙ engine est. · hist. avg − known bills</span>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                ) : (
                    <p className="py-3 text-[10px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                        <ArrowRight className="w-3 h-3" /> Hover any Cash In or Cash Out total for a breakdown · Click highlighted cells to manage details
                    </p>
                )}
            </div>
        </div>
    );
}
