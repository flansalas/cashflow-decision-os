import React from 'react';
import { RefreshCw, ChevronDown, Landmark, Repeat, PlusCircle } from 'lucide-react';

export function WeeklyRoutineCard() {
    return (
        <details className="rounded-2xl border overflow-hidden shadow-sm group transition-shadow hover:shadow-[0_8px_16px_rgba(15,23,42,0.04)] bg-white" style={{ borderColor: "var(--border-subtle)" }}>
            <summary className="px-6 py-4 cursor-pointer text-xs font-semibold uppercase tracking-wider select-none flex items-center justify-between hover:bg-slate-50 active:bg-slate-100/80 transition-colors group/summary" style={{ color: "var(--text-secondary)" }}>
                <span className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 text-slate-400 group-hover/summary:text-indigo-500 transition-colors" />
                    Weekly Cash Routine — Review in this order
                </span>
                <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-slate-400 opacity-0 group-hover/summary:opacity-100 transition-opacity">
                        View Routine
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform text-slate-400" />
                </div>
            </summary>
            <div className="border-t px-6 py-6 bg-slate-50/30" style={{ borderColor: 'var(--border-subtle)' }}>
                <p className="text-sm font-medium mb-6 text-slate-600">
                    Use this order to keep the forecast accurate and avoid double-counting cash.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {/* Step 1 */}
                    <div className="space-y-2">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider font-bold text-indigo-500">Step 1</span>
                            <div className="flex items-center gap-2 font-semibold text-slate-900">
                                <Landmark className="w-4 h-4 text-slate-400" />
                                Review Ledger
                            </div>
                        </div>
                        <p className="text-sm text-slate-500 leading-relaxed min-h-[60px]">
                            Open AR invoices and AP bills are already included in the forecast.
                        </p>
                        <a href="/cashflow" className="inline-flex items-center text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors">
                            Go to Ledger &rarr;
                        </a>
                    </div>

                    {/* Step 2 */}
                    <div className="space-y-2">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider font-bold text-indigo-500">Step 2</span>
                            <div className="flex items-center gap-2 font-semibold text-slate-900">
                                <Repeat className="w-4 h-4 text-slate-400" />
                                Verify Commitments
                            </div>
                        </div>
                        <p className="text-sm text-slate-500 leading-relaxed min-h-[60px]">
                            Use this for recurring non-invoiced cash flows like payroll, rent, subscriptions, or recurring revenue not already in AR.
                        </p>
                        <a href="/recurring" className="inline-flex items-center text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors">
                            Manage Commitments &rarr;
                        </a>
                    </div>

                    {/* Step 3 */}
                    <div className="space-y-2">
                        <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase tracking-wider font-bold text-indigo-500">Step 3</span>
                            <div className="flex items-center gap-2 font-semibold text-slate-900">
                                <PlusCircle className="w-4 h-4 text-slate-400" />
                                Add One-Time Adjustments
                            </div>
                        </div>
                        <p className="text-sm text-slate-500 leading-relaxed min-h-[60px]">
                            Use this only for unusual one-time items like tax payments, equipment purchases, deposits, or one-off cash events.
                        </p>
                        <a href="/cash-adjustments" className="inline-flex items-center text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors">
                            Add Adjustments &rarr;
                        </a>
                    </div>
                </div>
            </div>
        </details>
    );
}
