"use client";

import React from "react";
import { Plus } from "lucide-react";

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
    onEdit: (item: Commitment) => void;
    onWeekClick: (weekNum: number) => void;
    onAdd: () => void;
}

function fmt(n: number): string {
    if (n === 0) return "";
    return Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function PlannedEventsGrid({ commitments, weeks, onEdit, onWeekClick, onAdd }: Props) {
    const recurring = commitments.filter(c => c.cadence !== "one-time" && c.cadence !== "irregular" && !c.isAdjustment);
    const oneTime = commitments.filter(c => c.cadence === "one-time" || c.cadence === "irregular" || c.isAdjustment);

    // Compute cell value for a commitment in a specific week
    const getAmountForWeek = (c: Commitment, week: ForecastWeek) => {
        // We look at the breakdown items for this week to see if this commitment hit.
        // We match by sourceId === c.id
        const items = c.direction === "inflow" ? week.breakdown.inflows : week.breakdown.outflows;
        const matches = items.filter(i => i.sourceId === c.id || (c.isAdjustment && i.sourceId === c.id));
        if (matches.length > 0) {
            return matches.reduce((sum, i) => sum + i.amount, 0);
        }
        return 0;
    };

    const renderRow = (c: Commitment) => {
        return (
            <tr key={c.id} className="group hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
                <td 
                    className="p-3 whitespace-nowrap text-sm font-medium text-slate-800 border-r border-slate-200 cursor-pointer hover:text-indigo-600 transition-colors"
                    onClick={() => onEdit(c)}
                >
                    {c.displayName}
                    <div className="text-[10px] text-slate-400 font-normal uppercase tracking-wider mt-0.5">
                        {c.direction === "inflow" ? "Inflow" : "Outflow"}
                    </div>
                </td>
                {weeks.map(w => {
                    const amt = getAmountForWeek(c, w);
                    return (
                        <td 
                            key={w.weekNumber} 
                            onClick={() => onWeekClick(w.weekNumber)}
                            className="p-3 text-right text-sm font-financial cursor-pointer hover:bg-indigo-50/50 transition-colors border-r border-slate-100 last:border-0"
                            title={`Week ${w.weekNumber} (${new Date(w.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })})`}
                        >
                            {amt > 0 ? (
                                <span className={c.direction === "inflow" ? "text-emerald-600" : "text-slate-700"}>
                                    {fmt(amt)}
                                </span>
                            ) : null}
                        </td>
                    );
                })}
            </tr>
        );
    };

    return (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center justify-between p-4 border-b bg-slate-50/50" style={{ borderColor: "var(--border-subtle)" }}>
                <h2 className="text-sm font-bold text-slate-800">Planned Events</h2>
                <button 
                    onClick={onAdd}
                    className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-bold rounded-lg shadow-sm transition-all"
                    style={{ background: "var(--color-primary)", color: "white" }}
                >
                    <Plus className="w-3.5 h-3.5" /> Add Cash Commitment
                </button>
            </div>
            
            <div className="overflow-x-auto custom-scrollbar pb-2">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="p-3 w-48 min-w-[200px] font-bold text-xs uppercase tracking-widest text-slate-500 border-r border-slate-200">
                                Commitment
                            </th>
                            {weeks.map(w => (
                                <th 
                                    key={w.weekNumber} 
                                    onClick={() => onWeekClick(w.weekNumber)}
                                    className="p-3 min-w-[70px] text-center cursor-pointer hover:bg-slate-100 transition-colors border-r border-slate-200 last:border-0"
                                >
                                    <div className="text-xs font-bold text-slate-700">W{w.weekNumber}</div>
                                    <div className="text-[10px] text-slate-400 font-medium mt-0.5">
                                        {new Date(w.weekStart).toLocaleDateString("en-US", { month: "numeric", day: "numeric", timeZone: "UTC" })}
                                    </div>
                                </th>
                            ))}
                        </tr>
                        {/* Weekly Totals */}
                        <tr className="border-b-2 border-slate-200 bg-white">
                            <td className="p-3 text-xs font-bold uppercase tracking-widest text-slate-800 border-r border-slate-200">
                                Total Out This Week
                            </td>
                            {weeks.map(w => {
                                // Calculate total outflows for this week from planned items only
                                const out = w.breakdown.outflows
                                    .filter(i => i.sourceType === "recurring" || i.sourceType === "assumption" || i.section?.includes("Recurring") || i.section?.includes("What-If"))
                                    .reduce((sum, i) => sum + i.amount, 0);
                                return (
                                    <td key={w.weekNumber} className="p-3 text-right text-sm font-bold font-financial text-rose-600 border-r border-slate-100 last:border-0">
                                        {fmt(out)}
                                    </td>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {recurring.length > 0 && (
                            <>
                                <tr className="bg-slate-50/50">
                                    <td colSpan={14} className="p-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-y border-slate-200">
                                        — Recurring
                                    </td>
                                </tr>
                                {recurring.map(renderRow)}
                            </>
                        )}
                        {oneTime.length > 0 && (
                            <>
                                <tr className="bg-slate-50/50">
                                    <td colSpan={14} className="p-2 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-y border-slate-200">
                                        — One-Time
                                    </td>
                                </tr>
                                {oneTime.map(renderRow)}
                            </>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
