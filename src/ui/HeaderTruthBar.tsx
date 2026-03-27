"use client";

import React, { useState, useEffect } from "react";
import { AlertTriangle, RotateCw, ChevronDown, ArrowRight, ListFilter, ClipboardList, TrendingUp, TrendingDown } from "lucide-react";
import { RunwayMetric } from "./RunwayMetric";
import { HelpBubble } from "./HelpBubble";

function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface Props {
    bankBalance: number;
    adjustmentsTotal: number;
    adjustedCash: number;
    buffer: number;
    confidence: { score: number; label: string; reasons: string[] };
    lastUpdated: string;
    asOfDate: string;
    companyId: string;
    payroll: {
        nextDate: string | null;
        amount: number;
        confidence: string;
        source: string;
    } | null;
    payrollPromptNeeded: boolean;
    adjustments: Array<{ id: string; type: string; amount: number; note: string | null }>;
    onUpdateBalanceClick: () => void;
    onBalanceUpdated: () => void;
    expectedRunOutWeek: number | null;
    worstCaseRunOutWeek: number | null;
    // New fields for the ribbon
    inflow30: number;
    outflow30: number;
    isCompact?: boolean;
    companyName?: string;
    onToggleSetup?: () => void;
}

function SummarySection({ title, label, value, subValue, children, colorClass, highlight, isCompact }: { title: string, label?: string, value: string, subValue?: string, children?: React.ReactNode, colorClass?: string, highlight?: boolean, isCompact?: boolean }) {
    if (isCompact) {
        return (
            <div className="flex items-center gap-3 px-4 py-1.5 whitespace-nowrap group">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-slate-600 transition-colors">{title}:</span>
                <span className={`text-base font-black font-financial ${colorClass || "text-slate-900"}`}>{value}</span>
                {children}
            </div>
        );
    }

    return (
        <div className={`p-4 h-full flex flex-col justify-between group relative border-l-4 md:border-l-0 overflow-visible ${highlight ? 'border-l-slate-800 md:border-t-4 md:border-t-slate-800' : 'border-l-transparent md:border-t-4 md:border-t-transparent'}`}>
            <div>
                <p className="text-xs font-semibold mb-1 uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{title}</p>
                <div className="flex items-center justify-between">
                    <p className={`text-2xl sm:text-3xl font-bold font-financial leading-none tracking-tight gap-1 ${colorClass || "text-slate-900"}`}>{value}</p>
                </div>
                {subValue && <p className="text-xs font-medium mt-1 text-slate-500 truncate">{subValue}</p>}
                {label && <p className="text-xs font-medium mt-1 text-slate-500">{label}</p>}
            </div>
            {children && <div className="mt-3">{children}</div>}
        </div>
    );
}

import { Box, Settings2 } from "lucide-react";

export function HeaderTruthBar({
    bankBalance, adjustmentsTotal, adjustedCash, buffer,
    confidence, lastUpdated, asOfDate, companyId,
    payroll, payrollPromptNeeded, adjustments, onUpdateBalanceClick, onBalanceUpdated,
    expectedRunOutWeek, worstCaseRunOutWeek, inflow30, outflow30, isCompact, companyName, onToggleSetup
}: Props) {
    const [showAdj, setShowAdj] = useState(false);
    const [showReasons, setShowReasons] = useState(false);

    const [now, setNow] = useState<number | null>(null);
    useEffect(() => {
        const t = setTimeout(() => setNow(Date.now()), 0);
        return () => clearTimeout(t);
    }, [asOfDate]);
    const isStale = now ? Math.floor((now - new Date(asOfDate).getTime()) / 86_400_000) >= 5 : false;

    return (
        <div className={`transition-all duration-500 ease-in-out border shadow-sm bg-white relative ${isCompact ? 'rounded-xl max-h-12 overflow-hidden' : 'rounded-2xl max-h-[800px] overflow-visible'}`} style={{ borderColor: 'var(--border-default)' }}>
            
            {/* COMPACT VIEW (Absolute positioned over the top) */}
            <div className={`absolute inset-0 w-full h-12 px-4 flex items-center justify-between transition-all duration-500 ${isCompact ? 'opacity-100 pointer-events-auto delay-150' : 'opacity-0 pointer-events-none -translate-y-2'}`}>
                <div className="flex items-center gap-1">
                     <span className="font-black text-[10px] tracking-[0.2em] flex items-center gap-2 text-slate-900 mr-6">
                        <Box className="w-4 h-4 text-indigo-600" /> {companyName}
                     </span>
                     
                     <div className="flex items-center divide-x divide-slate-100">
                        <SummarySection title="Cash" value={fmt(adjustedCash)} isCompact />
                        <SummarySection title="In" value={fmt(inflow30)} colorClass="text-emerald-700" isCompact />
                        <SummarySection title="Out" value={fmt(outflow30)} colorClass="text-rose-600" isCompact />
                        <div className="px-4 flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Survival:</span>
                            <span className="text-sm font-black text-amber-600">{worstCaseRunOutWeek ?? '13'}+ Wks</span>
                        </div>
                     </div>
                </div>

                <div className="flex items-center gap-3">
                    <button onClick={onUpdateBalanceClick} className="text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-indigo-600 transition-colors">Reconcile</button>
                    <button onClick={onToggleSetup} className="p-1.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors">
                        <Settings2 className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                </div>
            </div>

            {/* FULL VIEW */}
            <div className={`transition-all duration-500 ${isCompact ? 'opacity-0 scale-y-95 pointer-events-none' : 'opacity-100 scale-y-100 pointer-events-auto duration-700 delay-100'}`}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 w-full divide-y md:divide-y-0 lg:divide-x" style={{ borderColor: 'var(--border-subtle)' }}>
                {/* Section 1: Cash on Hand */}
                <SummarySection 
                    title="Cash on Hand" 
                    value={fmt(adjustedCash)} 
                    subValue={adjustmentsTotal !== 0 ? `Adjusted from ${fmt(bankBalance)} bank` : "Verified Bank Balance"}
                    colorClass="text-slate-900"
                    highlight
                >
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <button onClick={onUpdateBalanceClick} className="btn-pill !py-1 text-xs !bg-slate-900 !text-white !border-slate-900 hover:!bg-slate-800 h-8">
                                <RotateCw className="w-3.5 h-3.5 mr-1" /> Reconcile
                            </button>
                            <button onClick={() => setShowAdj(!showAdj)} className="h-8 px-3 rounded-lg border text-xs font-medium hover:bg-slate-50 transition-colors" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}>
                                Adjustments
                            </button>
                            {isStale && <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" title="Bank data is stale" />}
                        </div>
                        {/* QBO Contextual Link */}
                        <a href="/cash-adjustments" className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 mt-2 transition-colors pl-1">
                             Manual Adjustments <ArrowRight className="w-3.5 h-3.5" />
                        </a>
                    </div>
                    {/* Popover for adj */}
                    {showAdj && (
                        <div className="absolute z-[60] top-full mt-2 w-72 border rounded-xl p-5 shadow-2xl bg-white left-0 animate-in fade-in slide-in-from-top-2 border-slate-200">
                            <div className="flex justify-between items-center mb-3">
                                 <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ledger Discrepancies</p>
                                 <button onClick={() => setShowAdj(false)} className="text-slate-300 hover:text-slate-600">&times;</button>
                            </div>
                            {adjustments.length === 0 ? (
                                <p className="text-xs italic text-slate-400">No pending adjustments</p>
                            ) : (
                                <div className="space-y-2">
                                    {adjustments.map(a => (
                                        <div key={a.id} className="flex justify-between text-xs">
                                            <span className="truncate pr-4 text-slate-500">{a.type.replace(/_/g, " ")}{a.note ? ` — ${a.note}` : ""}</span>
                                            <span className="font-financial font-bold text-slate-700">
                                                {a.amount >= 0 ? "+" : ""}{fmt(a.amount)}
                                            </span>
                                        </div>
                                    ))}
                                    <div className="pt-2 border-t mt-2 flex justify-between text-xs font-bold text-slate-900 uppercase tracking-wide">
                                        <span>Calculated Start</span>
                                        <span>{fmt(adjustedCash)}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </SummarySection>

                {/* Section 2: Money In */}
                <SummarySection 
                    title="Incoming (Next 30d)" 
                    value={fmt(inflow30)} 
                    subValue="Projected Collections"
                    colorClass="text-emerald-700"
                >
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <button onClick={() => setShowReasons(!showReasons)} className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 transition-colors h-8`}>
                                 {confidence.score}% Confidence
                            </button>
                        </div>
                        {/* QBO Contextual Link */}
                        <a href="/cashflow" className="text-xs font-medium text-emerald-600 hover:text-emerald-800 flex items-center gap-1 mt-2 transition-colors pl-1">
                             Review AR Grid <ArrowRight className="w-3.5 h-3.5" />
                        </a>
                        {showReasons && (
                            <div className="absolute z-[60] top-full mt-2 w-80 border rounded-xl p-5 shadow-2xl bg-white left-0 animate-in fade-in slide-in-from-top-2 border-slate-200">
                                 <div className="flex justify-between items-center mb-3">
                                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Inflow Quality Score</p>
                                    <button onClick={() => setShowReasons(false)} className="text-slate-300 hover:text-slate-600">&times;</button>
                                 </div>
                                 {confidence.reasons.map((r, i) => (
                                    <div key={i} className="text-xs mb-1.5 flex gap-2 text-slate-600">
                                        <span className="text-emerald-200">•</span> {r}
                                    </div>
                                 ))}
                            </div>
                        )}
                    </div>
                </SummarySection>

                {/* Section 3: Money Out */}
                <SummarySection 
                    title="Outgoing (Next 30d)" 
                    value={fmt(outflow30)} 
                    subValue="Drafts & Commitments"
                    colorClass="text-rose-600"
                >
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1.5">
                            {payroll ? (
                                <div className="px-3 py-1 rounded-lg border text-xs font-medium inline-flex items-center gap-1 bg-slate-50 border-slate-200 text-slate-600 h-8">
                                    Payroll {new Date(payroll.nextDate!).toLocaleDateString(undefined, { month: 'short', day: 'numeric'})}
                                </div>
                            ) : payrollPromptNeeded ? (
                                <div className="px-3 py-1 rounded-lg border text-xs font-medium inline-flex items-center gap-1 bg-amber-50 border-amber-200 text-amber-700 h-8">
                                    <AlertTriangle className="w-3.5 h-3.5" /> Payroll Info
                                </div>
                            ) : (
                                <div className="h-8 px-2 flex items-center text-xs font-medium text-slate-400">
                                    Stability: High
                                </div>
                            )}
                        </div>
                        {/* QBO Contextual Link */}
                        <a href="/recurring" className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 mt-2 transition-colors pl-1">
                             Review Commitments <ArrowRight className="w-3.5 h-3.5" />
                        </a>
                    </div>
                </SummarySection>

            {/* Section 4: Forecast Health */}
            <div className="lg:col-span-1 border-t md:border-t-0 p-6 flex flex-col justify-between group relative bg-white">
                {(() => {
                    const isExpectedSafe = expectedRunOutWeek === null;
                    const isWorstSafe = worstCaseRunOutWeek === null;
                    const status = (isExpectedSafe && isWorstSafe) ? "STABLE" : isExpectedSafe ? "VULNERABLE" : "CRITICAL";
                    
                    const statusConfig = {
                        STABLE: { 
                            glow: "bg-emerald-400/10"
                        },
                        VULNERABLE: { 
                            glow: "bg-amber-400/10"
                        },
                        CRITICAL: { 
                            glow: "bg-rose-400/10"
                        }
                    }[status];

                    return (
                        <>
                            <div className={`absolute top-0 right-0 w-48 h-48 rounded-full -mr-20 -mt-20 blur-3xl opacity-50 ${statusConfig.glow} pointer-events-none`} />
                            <RunwayMetric expectedWeek={expectedRunOutWeek} worstWeek={worstCaseRunOutWeek} />
                        </>
                    );
                })()}
            </div>
            </div>
            </div>
        </div>
    );
}
