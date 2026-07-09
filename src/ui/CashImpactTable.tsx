import React, { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from 'lucide-react';

function fmt(n: number) {
    if (n === null || n === undefined) return "$0";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function formatDate(dateStr: string) {
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    } catch {
        return dateStr;
    }
}

export function CashImpactTable({
    weeks,
    bufferMin
}: {
    weeks: any[];
    bufferMin: number;
}) {
    const [showEnding, setShowEnding] = useState(false);

    if (!weeks || weeks.length === 0) return null;

    let lowestCash = weeks[0].endCashExpected;
    let lowestWeek = weeks[0];

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
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mb-8">
            <div className={`px-6 py-4 border-b flex items-center justify-between ${statusColor}`}>
                <div className="flex items-center gap-3">
                    {statusIcon}
                    <div>
                        <h3 className="font-bold text-sm tracking-tight">{statusText}</h3>
                        <p className="text-xs font-medium opacity-80">
                            Lowest projected: <span className="font-financial font-bold">{fmt(lowestCash)}</span> in Week {lowestWeek.weekNumber} ({formatDate(lowestWeek.weekStart)})
                        </p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">Target Buffer</p>
                    <p className="text-sm font-financial font-bold opacity-90">{fmt(bufferMin)}</p>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead>
                        <tr>
                            <th className="px-4 py-3 font-semibold text-slate-500 bg-slate-50 border-b border-slate-200 sticky left-0 z-10 w-40 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">Metric</th>
                            {weeks.map(w => (
                                <th key={w.weekNumber} className="px-4 py-3 font-medium text-slate-500 bg-slate-50 border-b border-slate-200 min-w-[120px] text-right">
                                    <div className="text-xs font-bold text-slate-700">Week {w.weekNumber}</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">{formatDate(w.weekStart)} - {formatDate(w.weekEnd)}</div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {/* Beginning Cash (Primary) */}
                        <tr className="bg-white">
                            <td className="px-4 py-3 font-bold text-slate-900 sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] border-r border-slate-100">
                                Beginning Cash
                            </td>
                            {weeks.map(w => (
                                <td key={w.weekNumber} className="px-4 py-3 text-right font-financial font-bold text-slate-900">
                                    {fmt(w.startCash)}
                                </td>
                            ))}
                        </tr>

                        {/* Inflows */}
                        <tr className="bg-white">
                            <td className="px-4 py-2 font-medium text-slate-600 sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] border-r border-slate-100">
                                Inflows
                            </td>
                            {weeks.map(w => (
                                <td key={w.weekNumber} className="px-4 py-2 text-right font-financial text-emerald-600">
                                    +{fmt(w.inflowsExpected)}
                                </td>
                            ))}
                        </tr>

                        {/* Outflows */}
                        <tr className="bg-white">
                            <td className="px-4 py-2 font-medium text-slate-600 sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] border-r border-slate-100">
                                Outflows
                            </td>
                            {weeks.map(w => (
                                <td key={w.weekNumber} className="px-4 py-2 text-right font-financial text-red-600">
                                    -{fmt(w.outflowsExpected)}
                                </td>
                            ))}
                        </tr>

                        {/* Expected Ending Cash Toggle */}
                        <tr className="bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => setShowEnding(!showEnding)}>
                            <td colSpan={weeks.length + 1} className="px-4 py-2 text-center text-xs font-semibold text-slate-500 border-t border-slate-200">
                                <div className="flex items-center justify-center gap-1">
                                    {showEnding ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                    {showEnding ? "Hide Expected Ending Cash" : "Show Expected Ending Cash"}
                                </div>
                            </td>
                        </tr>

                        {/* Expected Ending Cash (Secondary) */}
                        {showEnding && (
                            <tr className="bg-slate-50/50">
                                <td className="px-4 py-3 font-semibold text-slate-700 sticky left-0 bg-slate-50/50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] border-r border-slate-200">
                                    Ending Cash
                                </td>
                                {weeks.map(w => {
                                    const isBelowBuffer = w.endCashExpected < bufferMin;
                                    const isExhausted = w.endCashExpected < 0;
                                    let textColor = "text-slate-700";
                                    if (isExhausted) textColor = "text-red-600";
                                    else if (isBelowBuffer) textColor = "text-amber-600";
                                    return (
                                        <td key={w.weekNumber} className={`px-4 py-3 text-right font-financial font-semibold ${textColor}`}>
                                            {fmt(w.endCashExpected)}
                                        </td>
                                    );
                                })}
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
