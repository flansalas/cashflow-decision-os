"use client";

import React, { useState } from "react";
import { X, ArrowRight, ArrowLeft, Calendar, FileEdit, Ban, AlertTriangle } from "lucide-react";
import { OccurrenceOverridePopover } from "./OccurrenceOverridePopover";

interface BreakdownItem {
    label: string;
    amount: number;
    type: string;
    sourceType: string;
    sourceId?: string;
    confidence: string;
    section?: string;
    direction?: "inflow" | "outflow";
}

interface ForecastWeek {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    startCash: number;
    endCashExpected: number;
    // ... other fields not needed here
}

interface Props {
    isOpen: boolean;
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    items: BreakdownItem[];
    allWeeks: ForecastWeek[];
    companyId: string;
    onClose: () => void;
    onSaved: () => void;
    onEditPattern: (item: BreakdownItem) => void;
    onManageAll?: () => void;
    hideManageAll?: boolean;
}

function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0 });
}

export function PlannedWeekPanel({
    isOpen, weekNumber, weekStart, weekEnd, items, allWeeks, companyId, onClose, onSaved, onEditPattern, onManageAll, hideManageAll
}: Props) {
    const [actionState, setActionState] = useState<{ type: 'defer' | 'skip', itemIdx: number } | null>(null);
    const [targetWeekNum, setTargetWeekNum] = useState<number | "">("");
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [overrideState, setOverrideState] = useState<{
        item: BreakdownItem;
        rect: DOMRect;
    } | null>(null);

    if (!isOpen) return null;

    const totalOut = items.filter(i => i.direction === "outflow" || (!i.direction && !i.section?.includes("Inflows"))).reduce((s, i) => s + i.amount, 0);
    const totalIn = items.filter(i => i.direction === "inflow" || (!i.direction && i.section?.includes("Inflows"))).reduce((s, i) => s + i.amount, 0);
    const net = totalIn - totalOut;

    const handleDefer = async (item: BreakdownItem) => {
        if (!targetWeekNum) return;
        setIsSaving(true);
        setError(null);
        try {
            const targetWeekStart = new Date(new Date(weekStart).getTime() + (Number(targetWeekNum) - weekNumber) * 7 * 86400000).toISOString().slice(0, 10);
            
            const res = await fetch("/api/recurring-reschedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    patternId: item.sourceId,
                    displayName: item.label,
                    amount: item.amount,
                    sourceWeekStart: weekStart,
                    targetWeekStart,
                    direction: item.section?.includes("Inflows") ? "inflow" : "outflow",
                }),
            });
            
            if (!res.ok) throw new Error("Failed to defer item");
            
            setActionState(null);
            setTargetWeekNum("");
            onSaved();
        } catch (e: any) {
            setError(e.message || "Failed to save");
        } finally {
            setIsSaving(false);
        }
    };

    const handleSkip = async (item: BreakdownItem) => {
        // To skip, we can defer it to some far future, or maybe we have a skip endpoint?
        // Let's assume there is an endpoint or we just show a message for now if not implemented.
        setError("Skip is not yet fully implemented on backend. Please use Defer or Edit.");
    };

    return (
        <div className="fixed inset-0 z-[100] flex justify-end">
            <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm transition-opacity" onClick={onClose} />
            
            <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 border-l border-slate-200">
                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 flex items-center gap-1">
                                <ArrowLeft className="w-3 h-3 cursor-pointer hover:text-indigo-800" onClick={onClose} /> Week {weekNumber}
                            </span>
                            <span className="text-slate-400 text-xs">—</span>
                            <span className="text-xs text-slate-500 font-medium">Cash Commitments</span>
                        </div>
                        <h2 className="text-lg font-bold text-slate-900 mt-1">
                            {new Date(weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – {new Date(weekEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                        </h2>
                        <div className="text-sm font-medium mt-1">
                            Total Net: <span className={net < 0 ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"}>{net < 0 ? "-" : "+"}{fmt(net)}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-200 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" /> {error}
                        </div>
                    )}
                    
                    {items.length === 0 ? (
                        <p className="text-sm text-slate-500 italic">No cash commitments this week.</p>
                    ) : items.map((item, idx) => {
                        const isOutflow = item.direction === "outflow" || (!item.direction && !item.section?.includes("Inflows"));
                        const isDeferring = actionState?.type === 'defer' && actionState.itemIdx === idx;
                        
                        return (
                            <div key={idx} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                <div className="p-4 bg-white flex items-center justify-between">
                                    <div className="flex-1 min-w-0 pr-4">
                                        <div className="font-semibold text-slate-900 truncate text-sm">{item.label}</div>
                                        <div className="text-[11px] text-slate-500 uppercase tracking-wider mt-0.5">
                                            {item.sourceType === "recurring" ? "Recurring" : "One-Time"}
                                        </div>
                                    </div>
                                    <div 
                                        onClick={(e) => {
                                            if (item.sourceType === "recurring" && item.sourceId) {
                                                setOverrideState({ item, rect: e.currentTarget.getBoundingClientRect() });
                                            }
                                        }}
                                        className={`font-bold font-financial text-right ${item.sourceType === "recurring" ? "cursor-pointer hover:opacity-70 transition-opacity" : ""} ${isOutflow ? "text-rose-600" : "text-emerald-600"}`}
                                        title={item.sourceType === "recurring" ? "Edit this week's amount" : undefined}
                                    >
                                        {isOutflow ? "-" : "+"}{fmt(item.amount)}
                                    </div>
                                </div>
                                
                                <div className="bg-slate-50 border-t border-slate-100 px-2 py-2 flex flex-wrap gap-1">
                                    <button 
                                        onClick={() => setActionState(isDeferring ? null : { type: 'defer', itemIdx: idx })}
                                        className={`px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 transition-colors ${isDeferring ? "bg-indigo-100 text-indigo-700" : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"}`}
                                    >
                                        <ArrowRight className="w-3.5 h-3.5" /> Defer
                                    </button>
                                    <button 
                                        onClick={() => onEditPattern(item)}
                                        className="px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition-colors"
                                    >
                                        <FileEdit className="w-3.5 h-3.5" /> Edit Pattern
                                    </button>
                                    <button 
                                        onClick={() => handleSkip(item)}
                                        className="px-3 py-1.5 text-xs font-semibold rounded-md flex items-center gap-1.5 text-slate-600 hover:bg-rose-50 hover:text-rose-700 transition-colors"
                                    >
                                        <Ban className="w-3.5 h-3.5" /> Skip
                                    </button>
                                </div>

                                {isDeferring && (
                                    <div className="p-4 border-t border-indigo-100 bg-indigo-50/50">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Calendar className="w-4 h-4 text-indigo-600" />
                                            <span className="text-xs font-bold text-indigo-900">Move to Week</span>
                                        </div>
                                        <div className="flex gap-2">
                                            <select 
                                                value={targetWeekNum}
                                                onChange={e => setTargetWeekNum(Number(e.target.value))}
                                                className="flex-1 text-sm rounded-lg px-3 py-2 border border-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none"
                                            >
                                                <option value="">Select target week...</option>
                                                {allWeeks.map(w => w.weekNumber !== weekNumber && (
                                                    <option key={w.weekNumber} value={w.weekNumber}>
                                                        Week {w.weekNumber} ({new Date(w.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })})
                                                    </option>
                                                ))}
                                            </select>
                                            <button 
                                                onClick={() => handleDefer(item)}
                                                disabled={!targetWeekNum || isSaving}
                                                className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                                            >
                                                {isSaving ? "Moving..." : "Confirm"}
                                            </button>
                                        </div>
                                        
                                        {/* Cash Impact Preview */}
                                        {targetWeekNum && (
                                            <div className="mt-3 p-3 bg-white border border-indigo-100 rounded-lg text-sm">
                                                <div className="font-semibold text-slate-700 mb-1">Live Impact:</div>
                                                <div className="text-slate-600 flex justify-between">
                                                    <span>Week {weekNumber} ending cash:</span>
                                                    <span className="font-mono">
                                                        <span className="line-through opacity-60 mr-2">{fmt(allWeeks.find(w => w.weekNumber === weekNumber)?.endCashExpected || 0)}</span>
                                                        <span className="font-bold text-emerald-600">
                                                            {fmt((allWeeks.find(w => w.weekNumber === weekNumber)?.endCashExpected || 0) + (isOutflow ? item.amount : -item.amount))}
                                                        </span>
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Footer */}
                {!hideManageAll && onManageAll && (
                    <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-center">
                        <button 
                            onClick={onManageAll}
                            className="text-sm font-bold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center gap-1"
                        >
                            Manage All Cash Commitments <ArrowRight className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </div>

            {overrideState && overrideState.item.sourceId && (
                <OccurrenceOverridePopover
                    companyId={companyId}
                    commitment={{
                        id: overrideState.item.sourceId,
                        displayName: overrideState.item.label
                    }}
                    weekStart={weekStart}
                    originalAmount={overrideState.item.amount}
                    rect={overrideState.rect}
                    onClose={() => setOverrideState(null)}
                    onSaved={() => {
                        setOverrideState(null);
                        onSaved();
                    }}
                />
            )}
        </div>
    );
}
