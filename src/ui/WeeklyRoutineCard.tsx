import React from 'react';
import { ArrowRight } from 'lucide-react';

export function WeeklyRoutineCard() {
    return (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-2.5 bg-slate-50/50 border rounded-lg" style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                Weekly Routine
            </span>
            <div className="flex flex-wrap items-center gap-3 flex-1">
                <a href="/cashflow" className="group flex items-baseline gap-1.5 hover:opacity-80 transition-opacity">
                    <span className="text-xs font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">1. Review Ledger</span>
                    <span className="text-[10px] text-slate-400 hidden md:inline">Synced AR & AP</span>
                </a>
                
                <ArrowRight className="w-3 h-3 text-slate-300 flex-shrink-0 hidden sm:block" />
                
                <a href="/recurring" className="group flex items-baseline gap-1.5 hover:opacity-80 transition-opacity">
                    <span className="text-xs font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">2. Verify Recurring Cash</span>
                    <span className="text-[10px] text-slate-400 hidden md:inline">Recurring cash</span>
                </a>
                
                <ArrowRight className="w-3 h-3 text-slate-300 flex-shrink-0 hidden sm:block" />
                
                <a href="/cash-adjustments" className="group flex items-baseline gap-1.5 hover:opacity-80 transition-opacity">
                    <span className="text-xs font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">3. Add One-Time Adjustments</span>
                    <span className="text-[10px] text-slate-400 hidden md:inline">One-time items</span>
                </a>
            </div>
        </div>
    );
}
