"use client";

import React, { useState, useMemo } from "react";
import { BarChart2, CornerDownRight, ChevronDown, ChevronRight } from "lucide-react";

interface ForecastSummaryGridProps {
    forecast: any;
    categories: any[];
    onCellClick?: (type: string, week: number, extraId?: string) => void;
}

function fmt(n: number) {
    if (!n) return "$0";
    return "$" + Math.round(n).toLocaleString("en-US");
}

function formatDateRange(start: string | Date, end: string | Date) {
    const s = new Date(start);
    const e = new Date(end);
    return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${e.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

interface HoveredInfo {
    type: "in" | "out";
    week: number;
    scheduled: number;
    recurring: number;
    projected: number;
    total: number;
    weekLabel: string;
    x: number;
    y: number;
}

// ── Floating Provenance Card ──────────────────────────────────────────────────
function SourceRow({
    dot, label, value, valueClass, children,
}: {
    dot: string; label: string; value: string; valueClass: string; children?: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
                <span className="text-[10px] truncate" style={{ color: "var(--text-secondary, #64748b)" }}>{label}</span>
                {children}
            </div>
            <span className={`text-[10px] font-bold shrink-0 ${valueClass}`}>{value}</span>
        </div>
    );
}

function ProvenanceCard({ info }: { info: HoveredInfo }) {
    const isIn = info.type === "in";

    const CARD_W = 220;
    const OFFSET_X = 18;
    const OFFSET_Y = -12;
    const vpW = typeof window !== "undefined" ? window.innerWidth : 1200;
    const left = info.x + OFFSET_X + CARD_W > vpW
        ? info.x - CARD_W - OFFSET_X
        : info.x + OFFSET_X;
    const top = info.y + OFFSET_Y;

    const methodNote = isIn
        ? "Engine estimate based on 90-day collection history, net of scheduled invoices and recurring items."
        : "Engine estimate based on historical avg. spend, net of known AP bills and recurring commitments.";

    return (
        <div
            style={{
                position: "fixed",
                top,
                left,
                width: CARD_W,
                zIndex: 9999,
                pointerEvents: "none",
                background: "var(--bg-surface, #fff)",
                borderColor: "var(--border-default, #e2e8f0)",
                backdropFilter: "blur(16px)",
                WebkitBackdropFilter: "blur(16px)",
            }}
            className="rounded-xl border shadow-xl px-4 py-3 animate-in fade-in zoom-in-95 duration-100"
        >
            {/* Label */}
            <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--text-muted)" }}>
                    {isIn ? "Projected Collections" : "Projected Spend"}
                </span>
                <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 font-semibold">est.</span>
            </div>

            {/* The number */}
            <p className="text-xl font-black font-financial tracking-tight text-slate-700 mb-2.5">
                {fmt(info.projected)}
            </p>

            {/* Methodology note */}
            <p className="text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {methodNote}
            </p>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────

export function ForecastSummaryGrid({ forecast, categories, onCellClick }: ForecastSummaryGridProps) {
    const weeks = useMemo(() => forecast?.weeks || [], [forecast]);
    const [inflowsExpanded, setInflowsExpanded] = useState(true);
    const [outflowsExpanded, setOutflowsExpanded] = useState(true);
    const [hoveredInfo, setHoveredInfo] = useState<HoveredInfo | null>(null);

    if (!weeks.length) return null;

    const renderCell = (amount: number, type: string, weekNum: number, extraId?: string) => {
        const isInteractive = onCellClick && !!type;
        return (
            <td
                key={weekNum}
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
        <>
            {hoveredInfo && hoveredInfo.projected > 0 && <ProvenanceCard info={hoveredInfo} />}

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
                                <th
                                    className="px-5 py-3 border-b border-r sticky left-0 z-10 font-bold text-[10px] uppercase tracking-[0.2em] w-[200px]"
                                    style={{ background: "var(--bg-base)", borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
                                >
                                    Week Timeline
                                </th>
                                {weeks.map((w: any) => (
                                    <th
                                        key={w.weekNumber}
                                        className="px-3 py-2 border-b border-r text-right font-medium text-[10px] leading-tight"
                                        style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
                                    >
                                        <div className="font-bold text-xs" style={{ color: "var(--text-primary)" }}>W{w.weekNumber}</div>
                                        {formatDateRange(w.weekStart, w.weekEnd)}
                                    </th>
                                ))}
                            </tr>
                            <tr>
                                <th
                                    className="px-5 py-4 border-b border-r sticky left-0 z-10 shadow-[2px_0_5px_rgba(0,0,0,0.02)]"
                                    style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
                                >
                                    <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-primary)" }}>Final Cash Balance</span>
                                </th>
                                {weeks.map((w: any) => (
                                    <th
                                        key={w.weekNumber}
                                        className="px-3 py-4 border-b border-r text-right"
                                        style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
                                    >
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
                                <td
                                    className="px-4 py-2 border-b border-r sticky left-0 z-10 font-bold text-xs uppercase tracking-wide flex items-center gap-2 w-[180px]"
                                    style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)", background: "var(--bg-base)" }}
                                >
                                    {inflowsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    Cash In
                                </td>
                                {weeks.map((w: any) => {
                                    const scheduled = w.breakdown.inflows
                                        .filter((i: any) => i.sourceType === "invoice")
                                        .reduce((s: number, i: any) => s + i.amount, 0);
                                    const recurring = w.breakdown.inflows
                                        .filter((i: any) => i.sourceType === "recurring")
                                        .reduce((s: number, i: any) => s + i.amount, 0);
                                    const projected = Math.max(0, w.inflowsExpected - scheduled - recurring);
                                    return (
                                        <td
                                            key={w.weekNumber}
                                            className="px-3 py-2 border-b border-r text-right text-xs font-bold cursor-default transition-colors"
                                            style={{
                                                borderColor: "var(--border-subtle)",
                                                background: hoveredInfo?.type === "in" && hoveredInfo.week === w.weekNumber
                                                    ? "rgba(5,150,105,0.06)"
                                                    : "var(--bg-base)",
                                            }}
                                            onMouseEnter={(e) => setHoveredInfo({
                                                type: "in", week: w.weekNumber,
                                                scheduled, recurring, projected,
                                                total: w.inflowsExpected,
                                                weekLabel: `W${w.weekNumber} · ${formatDateRange(w.weekStart, w.weekEnd)}`,
                                                x: e.clientX, y: e.clientY,
                                            })}
                                            onMouseMove={(e) => setHoveredInfo(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
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
                                        <td
                                            className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs font-semibold flex items-center gap-2 w-[180px]"
                                            style={{ background: "inherit", borderColor: "var(--border-subtle)" }}
                                        >
                                            <CornerDownRight className="w-3.5 h-3.5 text-emerald-500" /> AR Receipts
                                        </td>
                                        {weeks.map((w: any) => {
                                            const amount = w.breakdown.inflows
                                                .filter((i: any) => i.sourceType === "invoice")
                                                .reduce((s: number, i: any) => s + i.amount, 0);
                                            return renderCell(amount, "ar", w.weekNumber);
                                        })}
                                    </tr>
                                    {inCategories.map(cat => (
                                        <tr key={cat.id} className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                            <td
                                                className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs flex items-center gap-2 w-[180px]"
                                                style={{ background: "inherit", borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
                                            >
                                                <div className="w-3.5" /> <span className="truncate">{cat.name}</span>
                                            </td>
                                            {weeks.map((w: any) => {
                                                const amount = w.breakdown.inflows
                                                    .filter((i: any) => i.section === `Cat: ${cat.name}`)
                                                    .reduce((s: number, i: any) => s + i.amount, 0);
                                                return renderCell(amount, "cash-adjustments", w.weekNumber, cat.id);
                                            })}
                                        </tr>
                                    ))}
                                    <tr className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                        <td
                                            className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs flex items-center gap-2 w-[180px]"
                                            style={{ background: "inherit", borderColor: "var(--border-subtle)" }}
                                        >
                                            <div className="w-3.5" /> Recurring Inflows
                                        </td>
                                        {weeks.map((w: any) => {
                                            const amount = w.breakdown.inflows
                                                .filter((i: any) => i.sourceType === "recurring")
                                                .reduce((s: number, i: any) => s + i.amount, 0);
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
                                <td
                                    className="px-4 py-2 border-b border-r sticky left-0 z-10 font-bold text-xs uppercase tracking-wide flex items-center gap-2 w-[180px]"
                                    style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)", background: "var(--bg-base)" }}
                                >
                                    {outflowsExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                    Cash Out
                                </td>
                                {weeks.map((w: any) => {
                                    const scheduled = w.breakdown.outflows
                                        .filter((i: any) => i.sourceType === "bill")
                                        .reduce((s: number, i: any) => s + i.amount, 0);
                                    const recurring = w.breakdown.outflows
                                        .filter((i: any) => i.sourceType === "recurring")
                                        .reduce((s: number, i: any) => s + i.amount, 0);
                                    const projected = Math.max(0, w.outflowsExpected - scheduled - recurring);
                                    return (
                                        <td
                                            key={w.weekNumber}
                                            className="px-3 py-2 border-b border-r text-right text-xs font-bold cursor-default transition-colors"
                                            style={{
                                                borderColor: "var(--border-subtle)",
                                                background: hoveredInfo?.type === "out" && hoveredInfo.week === w.weekNumber
                                                    ? "rgba(225,29,72,0.05)"
                                                    : "var(--bg-base)",
                                            }}
                                            onMouseEnter={(e) => setHoveredInfo({
                                                type: "out", week: w.weekNumber,
                                                scheduled, recurring, projected,
                                                total: w.outflowsExpected,
                                                weekLabel: `W${w.weekNumber} · ${formatDateRange(w.weekStart, w.weekEnd)}`,
                                                x: e.clientX, y: e.clientY,
                                            })}
                                            onMouseMove={(e) => setHoveredInfo(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
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
                                        <td
                                            className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs font-semibold flex items-center gap-2 w-[180px]"
                                            style={{ background: "inherit", borderColor: "var(--border-subtle)" }}
                                        >
                                            <CornerDownRight className="w-3.5 h-3.5 text-red-500" /> AP Bills
                                        </td>
                                        {weeks.map((w: any) => {
                                            const amount = w.breakdown.outflows
                                                .filter((i: any) => i.sourceType === "bill")
                                                .reduce((s: number, i: any) => s + i.amount, 0);
                                            return renderCell(amount, "ap", w.weekNumber);
                                        })}
                                    </tr>
                                    <tr className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                        <td
                                            className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs font-semibold flex items-center gap-2 w-[180px]"
                                            style={{ background: "inherit", borderColor: "var(--border-subtle)" }}
                                        >
                                            <div className="w-3.5" /> Payroll
                                        </td>
                                        {weeks.map((w: any) => {
                                            const amount = w.breakdown.outflows
                                                .filter((i: any) => i.label?.toLowerCase().includes("payroll"))
                                                .reduce((s: number, i: any) => s + i.amount, 0);
                                            return renderCell(amount, "recurring-payroll", w.weekNumber);
                                        })}
                                    </tr>
                                    <tr className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                        <td
                                            className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs flex items-center gap-2 w-[180px]"
                                            style={{ background: "inherit", borderColor: "var(--border-subtle)" }}
                                        >
                                            <div className="w-3.5" /> Recurring Expenses
                                        </td>
                                        {weeks.map((w: any) => {
                                            const amount = w.breakdown.outflows
                                                .filter((i: any) => i.sourceType === "recurring" && !i.label?.toLowerCase().includes("payroll"))
                                                .reduce((s: number, i: any) => s + i.amount, 0);
                                            return renderCell(amount, "recurring", w.weekNumber);
                                        })}
                                    </tr>
                                    {outCategories.map(cat => (
                                        <tr key={cat.id} className="hover:bg-black/5" style={{ background: "var(--bg-surface)" }}>
                                            <td
                                                className="px-4 py-2 border-b border-r sticky left-0 z-10 text-xs flex items-center gap-2 w-[180px]"
                                                style={{ background: "inherit", borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
                                            >
                                                <div className="w-3.5" /> <span className="truncate">{cat.name}</span>
                                            </td>
                                            {weeks.map((w: any) => {
                                                const amount = w.breakdown.outflows
                                                    .filter((i: any) => i.section === `Cat: ${cat.name}`)
                                                    .reduce((s: number, i: any) => s + i.amount, 0);
                                                return renderCell(amount, "cash-adjustments", w.weekNumber, cat.id);
                                            })}
                                        </tr>
                                    ))}
                                </>
                            )}

                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}
