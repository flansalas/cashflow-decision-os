"use client";

import React, { useEffect, useState } from "react";
import { ArrowRight, TrendingUp, X } from "lucide-react";
import { VarianceDriverPanel } from "@/ui/VarianceDriverPanel";
import type { VarianceDriverResult } from "@/services/variance-drivers";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtVariance(n: number): string {
    const sign = n >= 0 ? "+" : "-";
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return sign + "$" + (abs / 1_000_000).toFixed(1) + "M";
    if (abs >= 1_000) return sign + "$" + (abs / 1_000).toFixed(1) + "K";
    return sign + "$" + abs.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// ─── Variance Modal ───────────────────────────────────────────────────────────

interface VarianceModalProps {
    data: VarianceDriverResult;
    onClose: () => void;
}

function VarianceModal({ data, onClose }: VarianceModalProps) {
    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            style={{ background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(8px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Last Forecast Check</p>
                        <h2 className="text-sm font-black text-slate-800 mt-0.5">Variance Explanation</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-400 hover:text-slate-700 transition-all"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Scrollable content */}
                <div className="p-5 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    <VarianceDriverPanel data={data} />
                </div>
            </div>
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function WeeklyRoutineCard() {
    const [latestDriverData, setLatestDriverData] = useState<VarianceDriverResult | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [loaded, setLoaded] = useState(false);

    // Fetch the latest checkpoint variance on mount — silently ignore all errors
    useEffect(() => {
        let cancelled = false;
        fetch("/api/variance-drivers?latest=true")
            .then(r => {
                if (!r.ok) throw new Error("no checkpoint");
                return r.json();
            })
            .then((data: VarianceDriverResult) => {
                if (!cancelled) {
                    setLatestDriverData(data);
                }
            })
            .catch(() => { /* fail silently — no checkpoint or API error */ })
            .finally(() => { if (!cancelled) setLoaded(true); });

        return () => { cancelled = true; };
    }, []);

    const variance = latestDriverData?.totalVariance;
    const hasCheckpoint = loaded && latestDriverData !== null && variance !== undefined;

    return (
        <>
            <div
                className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-2.5 bg-slate-50/50 border rounded-lg"
                style={{ borderColor: "var(--border-subtle)" }}
            >
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">
                    Weekly Routine
                </span>
                <div className="flex flex-wrap items-center gap-3 flex-1">
                    <a href="/cashflow" className="group flex items-baseline gap-1.5 hover:opacity-80 transition-opacity">
                        <span className="text-xs font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">1. Review Ledger</span>
                        <span className="text-[10px] text-slate-400 hidden md:inline">Synced AR &amp; AP</span>
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

                    {/* ── Last Forecast Check — shown only if checkpoint exists ── */}
                    {hasCheckpoint && (
                        <>
                            <ArrowRight className="w-3 h-3 text-slate-300 flex-shrink-0 hidden sm:block" />

                            <button
                                onClick={() => setModalOpen(true)}
                                className="group flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                                title="View last forecast variance explanation"
                            >
                                <TrendingUp className={`w-3 h-3 shrink-0 ${variance! >= 0 ? "text-emerald-500" : "text-rose-500"}`} />
                                <span className="text-xs font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">
                                    Last Forecast Check:&nbsp;
                                    <span className={`font-financial ${variance! >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                        {fmtVariance(variance!)}
                                    </span>
                                </span>
                                <span className="text-[10px] text-slate-400 hidden md:inline">variance →</span>
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Variance Modal */}
            {modalOpen && latestDriverData && (
                <VarianceModal data={latestDriverData} onClose={() => setModalOpen(false)} />
            )}
        </>
    );
}
