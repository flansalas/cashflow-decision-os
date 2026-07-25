"use client";

import React, { useState } from "react";
import type { UnifiedVarianceResult, LegacyVarianceResult, DeterministicVarianceResult, DeterministicDriverGroup, DeterministicDriverItem } from "@/types/variance";
import type { DriverItem, DriverGroup } from "@/services/variance-drivers";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";

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

// ─── Deterministic Sub-components ──────────────────────────────────────────────

function DeterministicDriverRow({ item }: { item: DeterministicDriverItem }) {
    const impactColor =
        item.varianceImpact > 0 ? "text-emerald-600" :
        item.varianceImpact < 0 ? "text-rose-600" :
        "text-slate-400";
    
    return (
        <div className="flex flex-col gap-1 py-1.5 px-3 rounded-lg hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
            <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                    <p className="text-xs font-medium text-slate-700 truncate">{item.displayLabel}</p>
                    {item.timing && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest bg-amber-100 text-amber-800">
                            {item.timing.daysShifted} days {item.timing.shiftDirection}
                        </span>
                    )}
                </div>
                <div className="text-right shrink-0">
                    <p className="text-xs font-financial font-bold text-slate-500">{fmtAbs(item.expectedAmount)}</p>
                    {item.varianceImpact !== 0 && (
                        <p className={`text-[10px] font-bold font-financial ${impactColor}`}>{fmt(item.varianceImpact)}</p>
                    )}
                </div>
            </div>
            {item.linkedAttributions && item.linkedAttributions.length > 0 && (
                <div className="pl-2 border-l-2 border-slate-200 mt-1 space-y-1">
                    {item.linkedAttributions.map((attr, idx) => (
                        <div key={idx} className="flex justify-between text-[10px] text-slate-500">
                            <span className="truncate pr-2">Matched: {attr.description}</span>
                            <span className="font-financial font-bold">{fmtAbs(attr.amountApplied)}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function DeterministicDriverSection({ group }: { group: DeterministicDriverGroup }) {
    const [open, setOpen] = useState(group.category !== "Matched Items");

    if (group.items.length === 0) return null;

    let accentColor = "text-slate-600";
    let bgColor = "bg-slate-50";
    let borderColor = "border-slate-200";

    if (group.category === "Timing Shifts") { accentColor = "text-amber-600"; bgColor = "bg-amber-50"; borderColor = "border-amber-100"; }
    else if (group.category === "Amount Differences") { accentColor = "text-amber-600"; bgColor = "bg-amber-50"; borderColor = "border-amber-100"; }
    else if (group.category === "Missed Forecast Items") { accentColor = "text-rose-600"; bgColor = "bg-rose-50"; borderColor = "border-rose-100"; }
    else if (group.category === "Unexpected Actual Cash") { accentColor = "text-emerald-600"; bgColor = "bg-emerald-50"; borderColor = "border-emerald-100"; }
    else if (group.category === "Unresolved Actual Cash") { accentColor = "text-slate-600"; bgColor = "bg-slate-100"; borderColor = "border-slate-300"; }

    const totalImpact = group.items.reduce((sum, item) => sum + item.varianceImpact, 0);

    return (
        <div className={`rounded-xl border overflow-hidden ${borderColor}`}>
            <button
                onClick={() => setOpen(o => !o)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors ${bgColor} hover:brightness-95`}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-black uppercase tracking-wider ${accentColor}`}>{group.category}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs font-financial font-bold ${accentColor}`}>
                        {totalImpact === 0 ? "no net impact" : fmt(totalImpact)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">{group.items.length} item{group.items.length !== 1 ? "s" : ""}</span>
                    {open ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                </div>
            </button>
            {open && (
                <div className="bg-white px-1 py-1 space-y-0.5">
                    {group.items.map((item, i) => (
                        <DeterministicDriverRow key={item.id} item={item} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Legacy Sub-components ─────────────────────────────────────────────────────

function LegacyDriverRow({ item }: { item: DriverItem }) {
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

interface LegacySectionProps {
    title: string;
    subtitle?: string;
    group: DriverGroup;
    accentColor: string;
    bgColor: string;
    borderColor: string;
    defaultOpen?: boolean;
    showUnverifiableNote?: boolean;
}

function LegacyDriverSection({
    title, subtitle, group, accentColor, bgColor, borderColor,
    defaultOpen = false, showUnverifiableNote = false,
}: LegacySectionProps) {
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
                        <LegacyDriverRow key={item.sourceId ?? `${item.label}-${i}`} item={item} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface VarianceDriverPanelProps {
    data: UnifiedVarianceResult;
}

export function VarianceDriverPanel({ data }: VarianceDriverPanelProps) {
    if (data.isDeterministic) {
        return <DeterministicVariancePanel data={data} />;
    } else {
        return <LegacyVariancePanel data={data} />;
    }
}

function DeterministicVariancePanel({ data }: { data: DeterministicVarianceResult }) {
    const variancePositive = data.totals.balanceBasedEndingCashVariance >= 0;
    const { cashReconciliation, totals } = data;

    return (
        <div className="space-y-4 text-sm">
            {/* ── Actual Cash Basis ──────────────────────────────────── */}
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                    Week of {formatWeekRange(data.weekStart, data.weekEnd)} · Actual Cash Basis
                </p>
                <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Bank Balance</span>
                    <span className="font-financial font-bold text-slate-700">{fmtAbs(cashReconciliation.actualEndingCash)}</span>
                </div>
                {cashReconciliation.adjustments !== 0 && (
                    <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Adjustments</span>
                        <span className={`font-financial font-bold ${cashReconciliation.adjustments >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                            {fmt(cashReconciliation.adjustments)}
                        </span>
                    </div>
                )}
                <div className="flex justify-between text-xs border-t border-slate-200 pt-1.5 font-bold">
                    <span className="text-slate-600">Adjusted Cash (Actual)</span>
                    <span className="font-financial text-slate-900">{fmtAbs(cashReconciliation.adjustedCash)}</span>
                </div>
                <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Forecast Expected</span>
                    <span className="font-financial text-slate-600">{fmtAbs(cashReconciliation.expectedEndingCash)}</span>
                </div>
            </div>

            {/* ── Variance headline ──────────────────────────────────── */}
            <div className={`rounded-xl border px-4 py-3 flex items-center justify-between ${
                variancePositive
                    ? "bg-emerald-50 border-emerald-100"
                    : "bg-rose-50 border-rose-100"
            }`}>
                <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cash vs. Expected</p>
                    <p className={`text-xl font-black font-financial mt-0.5 ${variancePositive ? "text-emerald-700" : "text-rose-700"}`}>
                        {fmt(totals.balanceBasedEndingCashVariance)}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">balance-based variance</p>
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">Explained</p>
                    <div className="flex items-center gap-2 justify-end">
                        <span className={`text-xs font-bold ${totals.transactionBasedForecastVariance >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                            {fmt(totals.transactionBasedForecastVariance)}
                        </span>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">transaction-based variance</p>
                </div>
            </div>

            {/* ── Cash Reconciliation Difference ────────────────────────── */}
            {totals.cashReconciliationDifference !== 0 && (
                <div className="rounded-xl border overflow-hidden border-slate-200">
                    <div className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors bg-slate-50">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-black uppercase tracking-wider text-slate-700">Cash Reconciliation Difference</span>
                            <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">Bank balance mismatch</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs font-financial font-bold text-slate-700">
                                {fmt(totals.cashReconciliationDifference)}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Deterministic Groups ───────────────────────────────── */}
            <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Variance Drivers</p>
                {data.groups.map(g => (
                    <DeterministicDriverSection key={g.category} group={g} />
                ))}
            </div>
        </div>
    );
}

function LegacyVariancePanel({ data }: { data: LegacyVarianceResult }) {
    const coveragePct = Math.round(data.explanationCoverage * 100);
    const variancePositive = data.totalVariance >= 0;

    return (
        <div className="space-y-4 text-sm">
            <div className="bg-amber-100 text-amber-800 text-xs px-3 py-2 rounded font-medium text-center">
                Legacy Explanation: This week predates deterministic tracking and is based on inferred current states.
            </div>

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
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Cash vs. Expected</p>
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
            {data.apNotPaid.count > 0 && data.apNotPaid.total > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-1">
                    <p className="text-xs text-amber-800 font-medium flex items-start gap-2">
                        <span className="mt-0.5">⚠️</span> 
                        <span>
                            <strong>Reality Check:</strong> {fmtAbs(data.apNotPaid.total)} of this extra cash is due to unpaid bills. Obligations still remain.
                        </span>
                    </p>
                </div>
            )}
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
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Variance Drivers (Inflows)</p>

                <LegacyDriverSection
                    title="Delayed Inflows"
                    subtitle="Expected to receive — didn't arrive"
                    group={data.arNotCollected}
                    accentColor="text-rose-600"
                    bgColor="bg-rose-50"
                    borderColor="border-rose-100"
                    defaultOpen={data.arNotCollected.count > 0}
                />
                <LegacyDriverSection
                    title="AR Collected"
                    subtitle="Received as expected"
                    group={data.arCollected}
                    accentColor="text-emerald-600"
                    bgColor="bg-emerald-50"
                    borderColor="border-emerald-100"
                />
                <LegacyDriverSection
                    title="AR Modified"
                    subtitle="Amount changed since forecast"
                    group={data.arModified}
                    accentColor="text-amber-600"
                    bgColor="bg-amber-50"
                    borderColor="border-amber-100"
                    defaultOpen={data.arModified.count > 0}
                />
                <LegacyDriverSection
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
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">Variance Drivers (Outflows)</p>

                <LegacyDriverSection
                    title="Deferred Outflows"
                    subtitle="Bills not yet paid (obligations remain)"
                    group={data.apNotPaid}
                    accentColor="text-amber-600"
                    bgColor="bg-amber-50"
                    borderColor="border-amber-100"
                    defaultOpen={data.apNotPaid.count > 0}
                />
                <LegacyDriverSection
                    title="AP Paid"
                    subtitle="Paid as expected"
                    group={data.apPaid}
                    accentColor="text-slate-500"
                    bgColor="bg-slate-50"
                    borderColor="border-slate-200"
                />
                <LegacyDriverSection
                    title="AP Modified"
                    subtitle="Amount changed since forecast"
                    group={data.apModified}
                    accentColor="text-amber-600"
                    bgColor="bg-amber-50"
                    borderColor="border-amber-100"
                    defaultOpen={data.apModified.count > 0}
                />
                <LegacyDriverSection
                    title="AP Deleted"
                    subtitle="Bill removed after forecast"
                    group={data.apDeleted}
                    accentColor="text-slate-500"
                    bgColor="bg-slate-50"
                    borderColor="border-slate-200"
                />
            </div>

            {/* ── Unmatched Difference ───────────────────────────────── */}
            {data.unexplainedResidual !== 0 && (
                <div className="rounded-xl border overflow-hidden border-slate-200">
                    <div className="w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors bg-slate-50">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="text-xs font-black uppercase tracking-wider text-slate-700">Unmatched Difference</span>
                            <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">Cash movements not matched to expected items.</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs font-financial font-bold text-slate-700">
                                {fmt(data.unexplainedResidual)}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Needs Review ───────────────────────────────────────── */}
            {(data.unverifiableRecurring.count > 0 || data.unverifiableBaseline.count > 0) && (
                <div className="space-y-1.5 mt-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-1">
                        Needs Review
                    </p>
                    <LegacyDriverSection
                        title="Recurring Commitments"
                        subtitle="No paid/cleared field available"
                        group={data.unverifiableRecurring}
                        accentColor="text-slate-400"
                        bgColor="bg-slate-50"
                        borderColor="border-slate-200"
                        showUnverifiableNote
                    />
                    <LegacyDriverSection
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
            <div className="px-1 mt-2 pb-2">
                <p className="text-[10px] text-slate-400">
                    Recurring commitments and baseline assumptions cannot be verified without bank transaction data.
                </p>
            </div>
        </div>
    );
}
