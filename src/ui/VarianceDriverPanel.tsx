"use client";

import React, { useState } from "react";
import type { VarianceDriverResult, DriverGroup, DriverItem } from "@/services/variance-drivers";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, HelpCircle } from "lucide-react";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
    const abs = Math.abs(n);
    const sign = n < 0 ? "-" : "+";
    if (abs >= 1_000_000) return sign + "$" + (abs / 1_000_000).toFixed(1) + "M";
    if (abs >= 1_000) return sign + "$" + (abs / 1_000).toFixed(1) + "K";
    return sign + "$" + abs.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtAbs(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatWeekRange(start: string, end: string): string {
    const s = new Date(start);
    const e = new Date(end);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
    return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", opts)}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function DriverRow({ item }: { item: DriverItem }) {
    const impactColor =
        item.impact > 0 ? "text-emerald-600" :
        item.impact < 0 ? "text-rose-600" :
        "text-slate-400";
    return (
        <div className="flex items-center justify-between gap-3 py-1.5 px-3 rounded-lg hover:bg-slate-50 transition-colors">
            <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-700 truncate">{item.label}</p>
                {item.currentStatus && (
                    <p className="text-[10px] text-slate-400 uppercase tracking-wide">{item.currentStatus}</p>
                )}
            </div>
            <div className="text-right shrink-0">
                <p className="text-xs font-financial font-bold text-slate-500">{fmtAbs(item.expectedAmount)}</p>
                {item.impact !== 0 && (
                    <p className={`text-[10px] font-bold font-financial ${impactColor}`}>{fmt(item.impact)}</p>
                )}
            </div>
        </div>
    );
}

interface SectionProps {
    title: string;
    subtitle?: string;
    group: DriverGroup;
    accentColor: string;     // tailwind text color class
    bgColor: string;         // tailwind bg color class
    borderColor: string;     // tailwind border color class
    defaultOpen?: boolean;
    showUnverifiableNote?: boolean;
}

function DriverSection({
    title, subtitle, group, accentColor, bgColor, borderColor,
    defaultOpen = false, showUnverifiableNote = false,
}: SectionProps) {
    const [open, setOpen] = useState(defaultOpen);

    if (group.count === 0) return null;

    return (
        <div className={`rounded-xl border overflow-hidden ${borderColor}`}>
            <button
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${bgColor} hover:brightness-95`}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-black uppercase tracking-wider ${accentColor}`}>{title}</span>
                    {subtitle && (
                        <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">{subtitle}</span>
                    )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs font-financial font-bold ${accentColor}`}>
                        {group.total === 0 ? "no net impact" : fmt(group.total)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">{group.count} item{group.count !== 1 ? "s" : ""}</span>
                    {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                </div>
            </button>
            {open && (
                <div className="bg-white px-1 py-1 space-y-0.5">
                    {showUnverifiableNote && (
                        <div className="flex items-start gap-2 px-3 py-2 text-[10px] text-slate-400 border-b border-slate-100 mb-1">
                            <HelpCircle className="w-3 h-3 shrink-0 mt-0.5" />
                            <span>No payment confirmation signal. Cannot determine if these occurred.</span>
                        </div>
                    )}
                    {group.items.map((item, i) => (
                        <DriverRow key={item.sourceId ?? `${item.label}-${i}`} item={item} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface VarianceDriverPanelProps {
    data: VarianceDriverResult;
}

export function VarianceDriverPanel({ data }: VarianceDriverPanelProps) {
    const coveragePct = Math.round(data.explanationCoverage * 100);
    const variancePositive = data.totalVariance >= 0;

    return (
        <div className="space-y-4 text-sm">
            {/* ── Actual Cash Basis ──────────────────────────────────── */}
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                    Week of {formatWeekRange(data.weekStart, data.weekEnd)} · Actual Cash Basis
                </p>
                <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Bank Balance</span>
                    <span className="font-financial font-bold text-slate-700">{fmtAbs(data.actualBankBalance)}</span>
                </div>
                {data.actualAdjustmentTotal !== 0 && (
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Adjustments</span>
                        <span className={`font-financial font-bold ${data.actualAdjustmentTotal >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                            {fmt(data.actualAdjustmentTotal)}
                        </span>
                    </div>
                )}
                <div className="flex justify-between text-xs border-t border-slate-200 pt-1.5 font-bold">
                    <span className="text-slate-600">Adjusted Cash (Actual)</span>
                    <span className="font-financial text-slate-900">{fmtAbs(data.actualAdjustedCash)}</span>
                </div>
                <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Forecast Expected</span>
                    <span className="font-financial text-slate-600">{fmtAbs(data.endCashExpected)}</span>
                </div>
            </div>

            {/* ── Variance headline ──────────────────────────────────── */}
            <div className={`rounded-xl border px-4 py-3 flex items-center justify-between ${
                variancePositive
                    ? "bg-emerald-50 border-emerald-100"
                    : "bg-rose-50 border-rose-100"
            }`}>
                <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Total Variance</p>
                    <p className={`text-xl font-black font-financial mt-0.5 ${variancePositive ? "text-emerald-700" : "text-rose-700"}`}>
                        {fmt(data.totalVariance)}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">vs forecast</p>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Explained</p>
                    <div className="flex items-center gap-2 justify-end">
                        <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${variancePositive ? "bg-emerald-500" : "bg-rose-500"}`}
                                style={{ width: `${Math.min(100, coveragePct)}%` }}
                            />
                        </div>
                        <span className={`text-xs font-bold ${variancePositive ? "text-emerald-700" : "text-rose-700"}`}>
                            {coveragePct}%
                        </span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">of variance explained</p>
                </div>
            </div>

            {/* ── Warnings ──────────────────────────────────────────── */}
            {data.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-2.5 space-y-1">
                    {data.warnings.map((w, i) => (
                        <p key={i} className="text-[11px] text-amber-700 flex items-center gap-1.5">
                            <span>⚠</span> {w}
                        </p>
                    ))}
                </div>
            )}

            {/* ── AR Drivers ─────────────────────────────────────────── */}
            <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Inflows (AR)</p>

                <DriverSection
                    title="AR Not Collected"
                    subtitle="Expected to receive — didn't arrive"
                    group={data.arNotCollected}
                    accentColor="text-rose-600"
                    bgColor="bg-rose-50"
                    borderColor="border-rose-100"
                    defaultOpen={data.arNotCollected.count > 0}
                />
                <DriverSection
                    title="AR Collected"
                    subtitle="Received as expected"
                    group={data.arCollected}
                    accentColor="text-emerald-600"
                    bgColor="bg-emerald-50"
                    borderColor="border-emerald-100"
                />
                <DriverSection
                    title="AR Modified"
                    subtitle="Amount changed since forecast"
                    group={data.arModified}
                    accentColor="text-amber-600"
                    bgColor="bg-amber-50"
                    borderColor="border-amber-100"
                    defaultOpen={data.arModified.count > 0}
                />
                <DriverSection
                    title="AR Deleted"
                    subtitle="Invoice removed after forecast"
                    group={data.arDeleted}
                    accentColor="text-slate-500"
                    bgColor="bg-slate-50"
                    borderColor="border-slate-200"
                />
            </div>

            {/* ── AP Drivers ─────────────────────────────────────────── */}
            <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Outflows (AP)</p>

                <DriverSection
                    title="AP Not Paid"
                    subtitle="Expected to pay — cash preserved"
                    group={data.apNotPaid}
                    accentColor="text-emerald-600"
                    bgColor="bg-emerald-50"
                    borderColor="border-emerald-100"
                    defaultOpen={data.apNotPaid.count > 0}
                />
                <DriverSection
                    title="AP Paid"
                    subtitle="Paid as expected"
                    group={data.apPaid}
                    accentColor="text-slate-500"
                    bgColor="bg-slate-50"
                    borderColor="border-slate-200"
                />
                <DriverSection
                    title="AP Modified"
                    subtitle="Amount changed since forecast"
                    group={data.apModified}
                    accentColor="text-amber-600"
                    bgColor="bg-amber-50"
                    borderColor="border-amber-100"
                    defaultOpen={data.apModified.count > 0}
                />
                <DriverSection
                    title="AP Deleted"
                    subtitle="Bill removed after forecast"
                    group={data.apDeleted}
                    accentColor="text-slate-500"
                    bgColor="bg-slate-50"
                    borderColor="border-slate-200"
                />
            </div>

            {/* ── Unverifiable ───────────────────────────────────────── */}
            {(data.unverifiableRecurring.count > 0 || data.unverifiableBaseline.count > 0) && (
                <div className="space-y-1.5">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">
                        Unverifiable (no ground-truth signal)
                    </p>
                    <DriverSection
                        title="Recurring Commitments"
                        subtitle="No paid/cleared field available"
                        group={data.unverifiableRecurring}
                        accentColor="text-slate-400"
                        bgColor="bg-slate-50"
                        borderColor="border-slate-200"
                        showUnverifiableNote
                    />
                    <DriverSection
                        title="Baseline Assumptions"
                        subtitle="No ground truth"
                        group={data.unverifiableBaseline}
                        accentColor="text-slate-400"
                        bgColor="bg-slate-50"
                        borderColor="border-slate-200"
                        showUnverifiableNote
                    />
                </div>
            )}

            {/* ── Summary footer ─────────────────────────────────────── */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-1.5">
                <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Explained variance</span>
                    <span className={`font-financial font-bold ${data.explainedVariance >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                        {fmt(data.explainedVariance)}
                    </span>
                </div>
                <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Unexplained residual</span>
                    <span className="font-financial font-bold text-slate-500">{fmt(data.unexplainedResidual)}</span>
                </div>
                <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-200">
                    Recurring commitments and baseline assumptions cannot be verified without bank transaction data.
                </p>
            </div>
        </div>
    );
}
