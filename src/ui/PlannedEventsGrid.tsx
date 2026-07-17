"use client";

import React from "react";
import { Plus, AlertTriangle, CheckCircle2 } from "lucide-react";

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
    status?: string;
    origin?: string;
    isAdjustment?: boolean;
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
    startCash: number;
    endCashExpected: number;
    inflowsExpected: number;
    outflowsExpected: number;
    breakdown: {
        outflows: WeekBreakdownItem[];
        inflows: WeekBreakdownItem[];
    };
}

interface Props {
    commitments: Commitment[];
    weeks: ForecastWeek[];
    bufferMin: number;
    onEdit: (item: Commitment) => void;
    onWeekClick: (weekNum: number) => void;
    onAdd: () => void;
}

function fmt(n: number): string {
    if (n === 0) return "";
    return Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function PlannedEventsGrid({ commitments, weeks, bufferMin, onEdit, onWeekClick, onAdd }: Props) {
    const recurring = commitments.filter(c => c.cadence !== "one-time" && c.cadence !== "irregular" && !c.isAdjustment);
    const oneTime = commitments.filter(c => c.cadence === "one-time" || c.cadence === "irregular" || c.isAdjustment);

    // Compute cell value for a commitment in a specific week
    const getAmountForWeek = (c: Commitment, week: ForecastWeek) => {
        // We look at the breakdown items for this week to see if this commitment hit.
        // We match by sourceId === c.id
        const items = c.direction === "inflow" ? week.breakdown.inflows : week.breakdown.outflows;
        const matches = items.filter(i => i.sourceId === c.id || (c.isAdjustment && i.sourceId === c.id) || (!i.sourceId && i.label === c.displayName));
        if (matches.length > 0) {
            return matches.reduce((sum, i) => sum + i.amount, 0);
        }
        return 0;
    };

    const renderRow = (c: Commitment, index: number) => {
        const rowBg = index % 2 === 0 ? "bg-white" : "bg-slate-50/30";
        return (
            <tr key={c.id} className={`group hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0 ${rowBg}`}>
                <td 
                    className={`px-3 py-1.5 whitespace-nowrap text-sm font-medium text-slate-800 border-r border-slate-200 cursor-pointer hover:text-indigo-600 transition-colors leading-snug sticky left-0 z-10 ${rowBg} shadow-[1px_0_0_0_#e2e8f0] group-hover:bg-slate-50`}
                    onClick={() => onEdit(c)}
                >
                    <div>{c.displayName}</div>
                    <div className="text-[10px] text-slate-400 font-normal uppercase tracking-wider">
                        {c.direction === "inflow" ? "Inflow" : "Outflow"}
                    </div>
                </td>
                {weeks.map(w => {
                    const amt = getAmountForWeek(c, w);
                    return (
                        <td 
                            key={w.weekNumber} 
                            onClick={() => onWeekClick(w.weekNumber)}
                            className="px-3 py-1.5 text-right text-sm font-financial cursor-pointer hover:bg-indigo-50/50 transition-colors border-r border-slate-100 last:border-0"
                            title={`Week ${w.weekNumber} (${new Date(w.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })})`}
                        >
                            {amt > 0 ? (
                                <span className={c.direction === "inflow" ? "text-emerald-600" : "text-slate-700 font-semibold"}>
                                    {fmt(amt)}
                                </span>
                            ) : <span className="text-slate-200 font-light">—</span>}
                        </td>
                    );
                })}
            </tr>
        );
    };

    let lowestCash = weeks.length > 0 ? weeks[0].endCashExpected : 0;
    let lowestWeek = weeks.length > 0 ? weeks[0] : null;

    weeks.forEach(w => {
        if (w.endCashExpected < lowestCash) {
            lowestCash = w.endCashExpected;
            lowestWeek = w;
        }
    });

    const isBufferBreached = lowestCash < bufferMin;
    const isExhausted = lowestCash < 0;

    let statusColor = "text-emerald-700 bg-emerald-50 border-emerald-200";
    let statusIcon = <CheckCircle2 className="w-5 h-5 text-emerald-600" />;
    let statusText = "Safe Buffer";

    if (isExhausted) {
        statusColor = "text-red-700 bg-red-50 border-red-200";
        statusIcon = <AlertTriangle className="w-5 h-5 text-red-600" />;
        statusText = "Cash Exhaustion Risk";
    } else if (isBufferBreached) {
        statusColor = "text-amber-700 bg-amber-50 border-amber-200";
        statusIcon = <AlertTriangle className="w-5 h-5 text-amber-600" />;
        statusText = "Buffer Breach Risk";
    }

    return (
        <div className="space-y-4">
            {lowestWeek && (
                <div className={`px-6 py-4 border rounded-xl flex items-center justify-between shadow-sm ${statusColor}`}>
                    <div className="flex items-center gap-3">
                        {statusIcon}
                        <div>
                            <h3 className="font-bold text-sm tracking-tight">{statusText}</h3>
                            <p className="text-xs font-medium opacity-80">
                                Lowest projected: <span className="font-financial font-bold">{lowestCash < 0 ? "-" : ""}${Math.abs(lowestCash).toLocaleString()}</span> in Week {lowestWeek.weekNumber} ({new Date(lowestWeek.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })})
                            </p>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Target Buffer</p>
                        <p className="text-sm font-financial font-bold opacity-90">${bufferMin.toLocaleString()}</p>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl border shadow-sm overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
                <div className="flex items-center justify-between p-4 border-b bg-slate-50/50" style={{ borderColor: "var(--border-subtle)" }}>
                    <h2 className="text-sm font-bold text-slate-800">Cash Commitments</h2>
                    <button 
                        onClick={onAdd}
                        className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-bold rounded-lg shadow-sm transition-all"
                        style={{ background: "var(--color-primary)", color: "white" }}
                    >
                        <Plus className="w-3.5 h-3.5" /> Add Cash Commitment
                    </button>
                </div>
                
                <div className="overflow-x-auto overflow-y-auto max-h-[70vh] custom-scrollbar pb-2">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-20 shadow-md">
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-3 py-2 w-48 min-w-[200px] font-bold text-xs uppercase tracking-widest text-slate-500 border-r border-slate-200 sticky left-0 z-30 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0]">
                                Commitment
                            </th>
                            {weeks.map(w => {
                                const wExhausted = w.endCashExpected < 0;
                                const wBreached = w.endCashExpected < bufferMin;
                                let headerColor = "text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100";
                                if (wExhausted) headerColor = "text-red-700 bg-red-50 border-red-200 hover:bg-red-100";
                                else if (wBreached) headerColor = "text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100";
                                else headerColor = "text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100"; // default safe

                                return (
                                    <th 
                                        key={w.weekNumber} 
                                        onClick={() => onWeekClick(w.weekNumber)}
                                        className={`px-3 py-2 min-w-[70px] text-center cursor-pointer transition-colors border-r last:border-0 ${headerColor}`}
                                    >
                                        <div className="text-xs font-bold">W{w.weekNumber}</div>
                                        <div className="text-[10px] opacity-70 font-medium mt-0.5">
                                            {new Date(w.weekStart).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" })}
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                        {/* Summary Rows (Cash Impact) */}
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <td className="px-3 py-1.5 text-xs font-medium text-slate-600 border-r border-slate-200 sticky left-0 z-30 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0]">
                                Beginning Cash
                            </td>
                            {weeks.map(w => (
                                <td key={`beg-${w.weekNumber}`} className="px-3 py-1.5 text-right text-xs font-financial font-semibold text-slate-700 border-r border-slate-200 last:border-0">
                                    ${w.startCash.toLocaleString()}
                                </td>
                            ))}
                        </tr>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <td className="px-3 py-1.5 text-xs font-medium text-slate-600 border-r border-slate-200 sticky left-0 z-30 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0]">
                                Inflows
                            </td>
                            {weeks.map(w => (
                                <td key={`in-${w.weekNumber}`} className="px-3 py-1.5 text-right text-xs font-financial text-emerald-600 border-r border-slate-200 last:border-0">
                                    +{fmt(w.inflowsExpected)}
                                </td>
                            ))}
                        </tr>
                        <tr className="bg-slate-50 border-b border-slate-300">
                            <td className="px-3 py-1.5 text-xs font-medium text-slate-600 border-r border-slate-200 sticky left-0 z-30 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0]">
                                Outflows
                            </td>
                            {weeks.map(w => (
                                <td key={`out-${w.weekNumber}`} className="px-3 py-1.5 text-right text-xs font-financial text-red-600 border-r border-slate-200 last:border-0">
                                    -{fmt(w.outflowsExpected)}
                                </td>
                            ))}
                        </tr>
                        <tr className="bg-slate-100 border-b border-slate-300">
                            <td className="px-3 py-2 text-xs font-bold text-slate-800 border-r border-slate-300 sticky left-0 z-30 bg-slate-100 shadow-[1px_0_0_0_#cbd5e1]">
                                Ending Cash
                            </td>
                            {weeks.map(w => {
                                const wExhausted = w.endCashExpected < 0;
                                const wBreached = w.endCashExpected < bufferMin;
                                let color = "text-slate-800";
                                if (wExhausted) color = "text-red-700";
                                else if (wBreached) color = "text-amber-700";
                                return (
                                    <td key={`end-${w.weekNumber}`} className={`px-3 py-2 text-right text-sm font-financial font-bold border-r border-slate-300 last:border-0 ${color}`}>
                                        ${w.endCashExpected.toLocaleString()}
                                    </td>
                                );
                            })}
                        </tr>
                        {/* Weekly Totals */}
                        <tr className="border-b-2 border-slate-300 bg-white shadow-sm">
                            <td className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-800 border-r border-slate-200 sticky left-0 z-30 bg-white shadow-[1px_0_0_0_#e2e8f0]">
                                Total Out This Week
                            </td>
                            {weeks.map(w => {
                                // Calculate total outflows for this week from planned items only
                                const out = w.breakdown.outflows
                                    .filter(i => i.sourceType === "recurring" || i.sourceType === "assumption" || i.section?.includes("Recurring") || i.section?.includes("What-If"))
                                    .reduce((sum, i) => sum + i.amount, 0);
                                return (
                                    <td key={w.weekNumber} className="px-3 py-2 text-right text-sm font-bold font-financial text-rose-600 border-r border-slate-100 last:border-0">
                                        {fmt(out)}
                                    </td>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {recurring.length > 0 && (
                            <>
                                <tr className="bg-slate-200">
                                    <td colSpan={14} className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-700 border-y-2 border-slate-300 sticky left-0 z-10 bg-slate-200">
                                        — Recurring
                                    </td>
                                </tr>
                                {recurring.map((c, i) => renderRow(c, i))}
                            </>
                        )}
                        {oneTime.length > 0 && (
                            <>
                                <tr className="bg-slate-200">
                                    <td colSpan={14} className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-700 border-y-2 border-slate-300 sticky left-0 z-10 bg-slate-200">
                                        — One-Time
                                    </td>
                                </tr>
                                {oneTime.map((c, i) => renderRow(c, i))}
                            </>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
        </div>
    );
}
