"use client";

import React, { useState } from "react";
import { Plus, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { OccurrenceOverridePopover } from "./OccurrenceOverridePopover";

export interface Commitment {
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
    description?: string | null;
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
    companyId: string;
}

function fmt(n: number): string {
    if (n === 0) return "";
    return Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function PlannedEventsGrid({ commitments, weeks, bufferMin, onEdit, onWeekClick, onAdd, companyId }: Props) {
    const [isSummaryExpanded, setIsSummaryExpanded] = useState(true);
    const [isRecurringExpanded, setIsRecurringExpanded] = useState(true);
    const [isOneTimeExpanded, setIsOneTimeExpanded] = useState(true);
    const [colWidth, setColWidth] = useState(250);
    const [overrideState, setOverrideState] = useState<{
        commitment: Commitment;
        weekStart: string;
        originalAmount: number;
        rect: DOMRect;
    } | null>(null);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.pageX;
        const startWidth = colWidth;
        
        const handleMouseMove = (moveEvent: MouseEvent) => {
            setColWidth(Math.max(150, Math.min(600, startWidth + (moveEvent.pageX - startX))));
        };
        
        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const recurring = commitments.filter(c => c.isIncluded && c.cadence !== "one-time" && c.cadence !== "irregular" && !c.isAdjustment);
    const oneTime = commitments.filter(c => c.isIncluded && (c.cadence === "one-time" || c.cadence === "irregular" || c.isAdjustment));

    const getTotalAmount = (c: Commitment) => {
        return weeks.reduce((sum, w) => {
            const items = c.direction === "inflow" ? w.breakdown.inflows : w.breakdown.outflows;
            const matches = items.filter(i => i.sourceId === c.id || (!i.sourceId && i.label === c.displayName));
            return sum + matches.reduce((s, i) => s + i.amount, 0);
        }, 0);
    };

    const sortedRecurring = [...recurring].sort((a, b) => {
        const aIsPayroll = a.displayName.toLowerCase().includes("payroll");
        const bIsPayroll = b.displayName.toLowerCase().includes("payroll");
        if (aIsPayroll && !bIsPayroll) return -1;
        if (!aIsPayroll && bIsPayroll) return 1;
        return getTotalAmount(b) - getTotalAmount(a);
    });

    const sortedOneTime = [...oneTime].sort((a, b) => getTotalAmount(b) - getTotalAmount(a));

    const getAmountForWeek = (c: Commitment, week: ForecastWeek) => {
        const items = c.direction === "inflow" ? week.breakdown.inflows : week.breakdown.outflows;
        const matches = items.filter(i => 
            i.sourceId === c.id || 
            (i.sourceId && i.sourceId.includes(c.id)) || 
            (c.isAdjustment && i.sourceId === c.id) || 
            (!i.sourceId && i.label === c.displayName)
        );
        if (matches.length > 0) {
            const amount = matches.reduce((sum, i) => sum + i.amount, 0);
            const isOverride = matches.some(i => i.type === "rescheduled" || (i.sourceId && i.sourceId.includes("resched-")));
            return { amount, isOverride };
        }
        return { amount: 0, isOverride: false };
    };

    const renderRow = (c: Commitment, index: number) => {
        const rowBg = index % 2 === 0 ? "bg-white" : "bg-slate-50";
        return (
            <tr key={c.id} className={`group hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0 ${rowBg}`}>
                <td 
                    style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }}
                    className={`px-3 py-1.5 whitespace-nowrap text-sm font-medium text-slate-800 border-r border-slate-200 cursor-pointer hover:text-indigo-600 transition-colors leading-snug sticky left-0 z-10 ${rowBg} shadow-[1px_0_0_0_#e2e8f0] group-hover:bg-slate-50 overflow-hidden text-ellipsis`}
                    onClick={() => onEdit(c)}
                >
                    <div>{c.displayName}</div>
                    <div className="text-[10px] text-slate-400 font-normal uppercase tracking-wider">
                        {c.direction === "inflow" ? "Inflow" : "Outflow"}
                    </div>
                </td>
                {weeks.map(w => {
                    const { amount: amt, isOverride } = getAmountForWeek(c, w);
                    return (
                        <td 
                            key={w.weekNumber} 
                            onClick={(e) => { 
                                if (amt !== 0) {
                                    if (c.cadence !== "one-time" && c.cadence !== "irregular" && !c.isAdjustment) {
                                        setOverrideState({
                                            commitment: c,
                                            weekStart: w.weekStart,
                                            originalAmount: amt,
                                            rect: e.currentTarget.getBoundingClientRect()
                                        });
                                    } else {
                                        onEdit(c); 
                                    }
                                } else { 
                                    onWeekClick(w.weekNumber); 
                                } 
                            }}
                            className={`px-3 py-1.5 text-right text-sm font-financial cursor-pointer hover:bg-indigo-50/50 transition-colors border-r border-slate-100 last:border-0 ${isOverride ? "bg-indigo-50/30" : ""}`}
                            title={`Week ${w.weekNumber} (${new Date(w.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })})`}
                        >
                            {amt > 0 ? (
                                <span className={`${c.direction === "inflow" ? "text-emerald-600" : "text-slate-700 font-semibold"} ${isOverride ? "text-indigo-700" : ""}`}>
                                    {fmt(amt)}{isOverride ? "*" : ""}
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
                <div className="overflow-x-auto overflow-y-auto max-h-[70vh] custom-scrollbar pb-2">
                <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-20 shadow-md">
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th 
                                className="px-0 py-0 sticky left-0 z-30 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0] border-r border-slate-200"
                            >
                                <div style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }} className="flex items-center justify-between h-full w-full">
                                    <div className="px-3 py-2 font-bold text-xs uppercase tracking-widest text-slate-500 whitespace-nowrap overflow-hidden flex-1 select-none text-left">Commitment</div>
                                    <div 
                                        onMouseDown={handleMouseDown}
                                        className="w-3 h-full cursor-col-resize hover:bg-indigo-300 transition-colors flex-shrink-0"
                                        style={{ touchAction: "none" }}
                                    />
                                </div>
                            </th>
                            {weeks.map(w => {
                                const wExhausted = w.endCashExpected < 0;
                                const wBreached = w.endCashExpected < bufferMin;
                                let headerColor = "text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100";
                                if (wExhausted) headerColor = "text-red-700 bg-red-50 border-red-200 hover:bg-red-100";
                                else if (wBreached) headerColor = "text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100";
                                else headerColor = "text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100";

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
                        <tr className="bg-slate-100 border-y border-slate-300 shadow-sm cursor-pointer hover:bg-slate-200 transition-colors" onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}>
                            <th style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }} className="px-3 py-1.5 text-left sticky left-0 z-30 bg-slate-100 font-normal shadow-[1px_0_0_0_#cbd5e1] whitespace-nowrap overflow-hidden">
                                <div className="text-xs font-bold uppercase tracking-widest text-slate-700 flex items-center gap-1">
                                    {isSummaryExpanded ? <ChevronDown className="w-3.5 h-3.5"/> : <ChevronRight className="w-3.5 h-3.5"/>}
                                    Cash Impact Summary
                                </div>
                            </th>
                            {weeks.map(w => <th key={`sum-hdr-${w.weekNumber}`} className="bg-slate-100" />)}
                        </tr>
                        {isSummaryExpanded && (
                            <>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }} className="px-3 py-1.5 text-xs font-medium text-slate-600 border-r border-slate-200 sticky left-0 z-30 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0] truncate text-left font-normal">
                                        Beginning Cash
                                    </th>
                                    {weeks.map(w => (
                                        <td key={`beg-${w.weekNumber}`} className="px-3 py-1.5 text-right text-xs font-financial font-semibold text-slate-700 border-r border-slate-200 last:border-0 bg-slate-50">
                                            ${w.startCash.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                        </td>
                                    ))}
                                </tr>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }} className="px-3 py-1.5 text-xs font-medium text-slate-600 border-r border-slate-200 sticky left-0 z-30 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0] truncate text-left font-normal">
                                        Inflows
                                    </th>
                                    {weeks.map(w => (
                                        <td key={`in-${w.weekNumber}`} className="px-3 py-1.5 text-right text-xs font-financial text-emerald-600 border-r border-slate-200 last:border-0 bg-slate-50">
                                            +{fmt(w.inflowsExpected)}
                                        </td>
                                    ))}
                                </tr>
                                <tr className="bg-slate-50 border-b border-slate-300">
                                    <th style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }} className="px-3 py-1.5 text-xs font-medium text-slate-600 border-r border-slate-200 sticky left-0 z-30 bg-slate-50 shadow-[1px_0_0_0_#e2e8f0] truncate text-left font-normal">
                                        Outflows
                                    </th>
                                    {weeks.map(w => (
                                        <td key={`out-${w.weekNumber}`} className="px-3 py-1.5 text-right text-xs font-financial text-red-600 border-r border-slate-200 last:border-0 bg-slate-50">
                                            -{fmt(w.outflowsExpected)}
                                        </td>
                                    ))}
                                </tr>
                                <tr className="border-b-2 border-slate-300 bg-white shadow-sm">
                                    <th style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }} className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-800 border-r border-slate-200 sticky left-0 z-30 bg-white shadow-[1px_0_0_0_#e2e8f0] whitespace-nowrap overflow-hidden text-left">
                                        Total Out This Week
                                    </th>
                                    {weeks.map(w => {
                                        const out = w.breakdown.outflows
                                            .filter(i => i.sourceType === "recurring" || i.sourceType === "assumption" || i.section?.includes("Recurring") || i.section?.includes("What-If"))
                                            .reduce((sum, i) => sum + i.amount, 0);
                                        return (
                                            <td key={w.weekNumber} className="px-3 py-2 text-right text-sm font-bold font-financial text-rose-600 border-r border-slate-100 last:border-0 bg-white">
                                                {fmt(out)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            </>
                        )}
                        <tr className="bg-slate-100 border-b border-slate-300 shadow-sm">
                            <th style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }} className="px-3 py-2 text-xs font-bold text-slate-800 border-r border-slate-300 sticky left-0 z-30 bg-slate-100 shadow-[1px_0_0_0_#cbd5e1] truncate text-left">
                                Ending Cash
                            </th>
                            {weeks.map(w => {
                                const wExhausted = w.endCashExpected < 0;
                                const wBreached = w.endCashExpected < bufferMin;
                                let color = "text-slate-800";
                                if (wExhausted) color = "text-red-600";
                                else if (wBreached) color = "text-amber-600";
                                
                                return (
                                    <td key={`end-${w.weekNumber}`} className={`px-3 py-2 text-right text-sm font-bold font-financial border-r border-slate-300 last:border-0 bg-slate-100 shadow-[1px_0_0_0_#cbd5e1] ${color}`}>
                                        ${w.endCashExpected.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                    </td>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {recurring.length > 0 && (
                            <>
                                <tr className="bg-slate-200 cursor-pointer hover:bg-slate-300 transition-colors" onClick={() => setIsRecurringExpanded(!isRecurringExpanded)}>
                                    <td style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }} className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-700 border-y-2 border-slate-300 sticky left-0 z-10 bg-slate-200 shadow-[1px_0_0_0_#cbd5e1] whitespace-nowrap overflow-hidden">
                                        <div className="flex items-center gap-1.5">
                                            {isRecurringExpanded ? <ChevronDown className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
                                            — Recurring
                                        </div>
                                    </td>
                                    {weeks.map(w => <td key={`rec-hdr-${w.weekNumber}`} className="border-y-2 border-slate-300 bg-slate-200" />)}
                                </tr>
                                {isRecurringExpanded && sortedRecurring.map((c, i) => renderRow(c, i))}
                            </>
                        )}
                        {oneTime.length > 0 && (
                            <>
                                <tr className="bg-slate-200 cursor-pointer hover:bg-slate-300 transition-colors" onClick={() => setIsOneTimeExpanded(!isOneTimeExpanded)}>
                                    <td style={{ width: colWidth, minWidth: colWidth, maxWidth: colWidth }} className="px-3 py-2 text-xs font-bold uppercase tracking-widest text-slate-700 border-y-2 border-slate-300 sticky left-0 z-10 bg-slate-200 shadow-[1px_0_0_0_#cbd5e1] whitespace-nowrap overflow-hidden">
                                        <div className="flex items-center gap-1.5">
                                            {isOneTimeExpanded ? <ChevronDown className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
                                            — One-Time
                                        </div>
                                    </td>
                                    {weeks.map(w => <td key={`ot-hdr-${w.weekNumber}`} className="border-y-2 border-slate-300 bg-slate-200" />)}
                                </tr>
                                {isOneTimeExpanded && sortedOneTime.map((c, i) => renderRow(c, i))}
                            </>
                        )}
                    </tbody>
                </table>
            </div>

            {overrideState && (
                <OccurrenceOverridePopover
                    companyId={companyId}
                    commitment={overrideState.commitment}
                    weekStart={overrideState.weekStart}
                    originalAmount={overrideState.originalAmount}
                    rect={overrideState.rect}
                    onClose={() => setOverrideState(null)}
                    onSaved={() => {
                        setOverrideState(null);
                        window.location.reload(); 
                    }}
                />
            )}
        </div>
        </div>
    );
}
