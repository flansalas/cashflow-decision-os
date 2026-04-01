"use client";

import React, { useState, useEffect } from "react";
import { AlertTriangle, RotateCw, ChevronDown, ArrowRight, ListFilter, ClipboardList, TrendingUp, TrendingDown } from "lucide-react";
import { RunwayMetric } from "./RunwayMetric";
import { HelpBubble } from "./HelpBubble";
import { GlobalSearch } from "./GlobalSearch";

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
    // Drill-down + scenario numbers (replaces ForecastBanner sidebar)
    onDrillIn?: () => void;
    lowestExpected?: number;
    lowestWorst?: number;
    zoneBoundary?: string;
}

function SummarySection({ title, label, value, subValue, children, colorClass, highlight, isCompact }: { title: string, label?: string, value: string | React.ReactNode, subValue?: string, children?: React.ReactNode, colorClass?: string, highlight?: boolean, isCompact?: boolean }) {
    if (isCompact) {
        return (
            <div className="flex items-center gap-3 px-4 py-1.5 whitespace-nowrap group relative">
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-slate-600 transition-colors">{title}:</span>
                <span className={`text-base font-black font-financial ${colorClass || "text-slate-900"}`}>{value}</span>
                {children}
            </div>
        );
    }

    return (
        <div className={`px-5 py-3 h-full flex flex-col justify-between group relative border-l-4 md:border-l-0 overflow-visible ${highlight ? 'border-l-slate-800 md:border-t-4 md:border-t-slate-800' : 'border-l-transparent md:border-t-4 md:border-t-transparent'}`}>
            <div>
                <p className="text-[10px] font-bold mb-0.5 uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{title}</p>
                <div className="flex items-center justify-between">
                    <div className={`text-2xl font-black font-financial leading-none tracking-tight gap-1 relative ${colorClass || "text-slate-900"}`}>{value}</div>
                </div>
                {subValue && <p className="text-[11px] font-medium mt-1 text-slate-500 truncate">{subValue}</p>}
                {label && <p className="text-[11px] font-medium mt-1 text-slate-500">{label}</p>}
            </div>
            {children && <div className="mt-2">{children}</div>}
        </div>
    );
}

import { Box, Settings2, Search, Trash2, CheckCircle2 } from "lucide-react";

export function HeaderTruthBar({
    bankBalance, adjustmentsTotal, adjustedCash, buffer,
    confidence, lastUpdated, asOfDate, companyId,
    payroll, payrollPromptNeeded, adjustments, onUpdateBalanceClick, onBalanceUpdated,
    expectedRunOutWeek, worstCaseRunOutWeek, inflow30, outflow30, isCompact, companyName,
    onDrillIn, lowestExpected, lowestWorst, zoneBoundary
}: Props) {
    const [showAdj, setShowAdj] = useState(false);
    const [showReasons, setShowReasons] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);

    // Edit Balance Popover
    const [editBalanceOpen, setEditBalanceOpen] = useState(false);
    const [tempBalance, setTempBalance] = useState(bankBalance.toString());
    const [tempAdjustments, setTempAdjustments] = useState(adjustments);
    const [isSavingBalance, setIsSavingBalance] = useState(false);

    useEffect(() => {
        if (editBalanceOpen) {
            setTempBalance(bankBalance.toString());
            setTempAdjustments(adjustments);
        }
    }, [editBalanceOpen, bankBalance, adjustments]);

    const handleSaveBalance = async () => {
        setIsSavingBalance(true);
        try {
            const parsedBalance = parseFloat(tempBalance.replace(/[$,\s]/g, ""));
            const res = await fetch("/api/cash-checkin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    bankBalance: isNaN(parsedBalance) ? 0 : parsedBalance,
                    asOfDate,
                    adjustments: tempAdjustments.map(({ id, ...rest }) => rest), // Remove id
                }),
            });
            if (res.ok) {
                setEditBalanceOpen(false);
                onBalanceUpdated();
            }
        } finally {
            setIsSavingBalance(false);
        }
    };

    const handleRemoveTempAdj = (id: string) => {
        setTempAdjustments(prev => prev.filter(a => a.id !== id));
    };

    const handleUpdateTempAdj = (id: string, updates: Partial<{ amount: number; note: string | null }>) => {
        setTempAdjustments(prev => prev.map(a => a.id === id ? { ...a, ...updates } : a));
    };

    const tempParsedBalance = parseFloat(tempBalance.replace(/[$,\s]/g, ""));
    const tempAdjTotal = tempAdjustments.reduce((sum, a) => sum + a.amount, 0);
    const tempAdjustedCash = (isNaN(tempParsedBalance) ? 0 : tempParsedBalance) + tempAdjTotal;

    // Global Cmd+K listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                setSearchOpen((prev) => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    const [now, setNow] = useState<number | null>(null);
    useEffect(() => {
        const t = setTimeout(() => setNow(Date.now()), 0);
        return () => clearTimeout(t);
    }, [asOfDate]);
    const isStale = now ? Math.floor((now - new Date(asOfDate).getTime()) / 86_400_000) >= 5 : false;

    return (
        <div className={`transition-all duration-500 ease-in-out border shadow-sm bg-white relative ${isCompact ? 'rounded-xl max-h-12 overflow-hidden' : 'rounded-2xl max-h-[800px] overflow-visible'}`} style={{ borderColor: 'var(--border-default)' }}>
            <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
            
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
                    <button onClick={() => setSearchOpen(true)} className="p-1.5 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors" title="Search (Cmd+K)">
                        <Search className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                </div>
            </div>

            {/* FULL VIEW */}
            <div className={`transition-all duration-500 ${isCompact ? 'opacity-0 scale-y-95 pointer-events-none' : 'opacity-100 scale-y-100 pointer-events-auto duration-700 delay-100'}`}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 w-full divide-y md:divide-y-0 lg:divide-x" style={{ borderColor: 'var(--border-subtle)' }}>
                {/* Section 1: Cash on Hand */}
                <SummarySection 
                    title="Cash on Hand" 
                    value={
                        <div className="relative inline-block w-full">
                            <span 
                                onClick={() => setEditBalanceOpen(!editBalanceOpen)} 
                                className="cursor-pointer hover:text-indigo-600 transition-colors border-b border-dashed border-slate-300 hover:border-indigo-600 block line-clamp-1 truncate w-[80%] md:w-auto overflow-hidden whitespace-nowrap"
                                title="Click to edit balance and outstanding items"
                            >
                                {fmt(adjustedCash)}
                            </span>
                            
                            {editBalanceOpen && (
                                <>
                                    <div className="fixed inset-0 z-[50]" onClick={() => setEditBalanceOpen(false)} />
                                    <div className="absolute z-[60] top-full mt-2 w-80 border rounded-2xl p-5 shadow-2xl bg-white left-0 animate-in fade-in slide-in-from-top-2 border-slate-200">
                                        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                                            <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Fast Reconcile</p>
                                            <button onClick={() => setEditBalanceOpen(false)} className="text-slate-400 hover:text-slate-700 transition">&times;</button>
                                        </div>
                                        
                                        <div className="space-y-4">
                                            <div>
                                                <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">State Balance</label>
                                                <div className="relative">
                                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 font-financial">$</span>
                                                    <input 
                                                        type="text" 
                                                        inputMode="decimal"
                                                        value={tempBalance} 
                                                        onChange={e => setTempBalance(e.target.value)} 
                                                        className="w-full border border-slate-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none rounded-xl pl-7 pr-3 py-2 text-sm font-financial font-bold transition-all text-slate-800"
                                                    />
                                                </div>
                                            </div>

                                            {tempAdjustments.length > 0 && (
                                                <div>
                                                    <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Outstanding Items (Click to Edit)</label>
                                                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                                                        {tempAdjustments.map(a => (
                                                            <div key={a.id} className="flex flex-col gap-1.5 p-2 rounded-lg border border-slate-100 bg-slate-50 group hover:border-indigo-200 transition-colors">
                                                                <div className="flex justify-between items-center gap-2">
                                                                    <div className="flex-1 min-w-0">
                                                                        <input 
                                                                            type="text"
                                                                            value={a.note || ""}
                                                                            placeholder={a.type.replace(/_/g, " ")}
                                                                            onChange={(e) => handleUpdateTempAdj(a.id, { note: e.target.value })}
                                                                            className="w-full bg-transparent border-none p-0 text-xs font-medium text-slate-700 focus:ring-0 placeholder:text-slate-400 outline-none"
                                                                        />
                                                                        <p className="text-[8px] text-slate-400 uppercase font-black">{a.type.replace(/_/g, " ")}</p>
                                                                    </div>
                                                                    <div className="flex items-center gap-1.5 shrink-0">
                                                                        <div className="relative">
                                                                            <span className={`absolute left-1 top-1/2 -translate-y-1/2 text-[10px] font-financial font-bold ${a.amount >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                                                                                {a.amount >= 0 ? "+" : "–"}
                                                                            </span>
                                                                            <input 
                                                                                type="text"
                                                                                value={Math.abs(a.amount).toString()}
                                                                                onChange={(e) => {
                                                                                    const val = parseFloat(e.target.value.replace(/[^-0-9.]/g, ""));
                                                                                    if (!isNaN(val)) {
                                                                                        handleUpdateTempAdj(a.id, { amount: a.amount >= 0 ? val : -val });
                                                                                    }
                                                                                }}
                                                                                className={`w-14 bg-transparent border-none p-0 pl-3.5 text-xs font-financial font-bold focus:ring-0 text-right outline-none ${a.amount >= 0 ? "text-emerald-600" : "text-rose-600"}`}
                                                                            />
                                                                        </div>
                                                                        <button 
                                                                            onClick={() => handleRemoveTempAdj(a.id)}
                                                                            className="text-slate-300 hover:text-rose-500 transition-colors p-1 rounded hover:bg-white"
                                                                        >
                                                                            <Trash2 className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex justify-between items-center text-sm">
                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Adjusted</span>
                                                <span className={`font-financial font-black ${tempAdjustedCash < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{fmt(tempAdjustedCash)}</span>
                                            </div>

                                            <button 
                                                onClick={handleSaveBalance} 
                                                disabled={isSavingBalance}
                                                className="w-full py-2.5 rounded-xl text-xs font-black tracking-widest uppercase text-white transition-all bg-indigo-600 hover:bg-indigo-700 active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                                            >
                                                {isSavingBalance ? "Saving..." : <><CheckCircle2 className="w-4 h-4" /> Save & Re-Roll</>}
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    } 
                    subValue={adjustmentsTotal !== 0 ? `Adjusted from ${fmt(bankBalance)} bank` : "Verified Bank Balance"}
                    colorClass="text-slate-900"
                    highlight
                >
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5">
                            <button onClick={onUpdateBalanceClick} className="btn-pill !py-0.5 px-2 text-[10px] !bg-slate-900 !text-white !border-slate-900 hover:!bg-slate-800 h-6">
                                <RotateCw className="w-3 h-3 mr-1" /> Reconcile
                            </button>
                            <button onClick={() => setShowAdj(!showAdj)} className="h-6 px-2 rounded-md border text-[10px] font-medium hover:bg-slate-50 transition-colors" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}>
                                Adjustments
                            </button>
                            <button onClick={() => setSearchOpen(true)} className="h-6 px-2 rounded-md border text-[10px] font-medium hover:bg-slate-50 transition-colors flex items-center justify-center" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }} title="Search (Cmd+K)">
                                <Search className="w-3 h-3" />
                            </button>
                            {isStale && <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse ml-1" title="Bank data is stale" />}
                        </div>

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
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5">
                            <button onClick={() => setShowReasons(!showReasons)} className={`px-2 py-0.5 rounded-md text-[10px] font-medium flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 transition-colors h-6`}>
                                 {confidence.score}% Confidence
                            </button>
                        </div>

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
                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5">
                            {payroll ? (
                                <div className="px-2 py-0.5 rounded-md border text-[10px] font-medium inline-flex items-center gap-1 bg-slate-50 border-slate-200 text-slate-600 h-6">
                                    Payroll {new Date(payroll.nextDate!).toLocaleDateString(undefined, { month: 'short', day: 'numeric'})}
                                </div>
                            ) : payrollPromptNeeded ? (
                                <div className="px-2 py-0.5 rounded-md border text-[10px] font-medium inline-flex items-center gap-1 bg-amber-50 border-amber-200 text-amber-700 h-6">
                                    <AlertTriangle className="w-3 h-3" /> Payroll Info
                                </div>
                            ) : (
                                <div className="h-6 px-1 flex items-center text-[10px] font-medium text-slate-400">
                                    Stability: High
                                </div>
                            )}
                        </div>

                    </div>
                </SummarySection>

            {/* Section 4: Forecast Health */}
            <div className="lg:col-span-1 border-t md:border-t-0 px-5 py-3 flex flex-col justify-center group relative bg-white min-h-[100px]">
                {(() => {
                    const isExpectedSafe = expectedRunOutWeek === null;
                    const isWorstSafe = worstCaseRunOutWeek === null;
                    const status = (isExpectedSafe && isWorstSafe) ? "STABLE" : isExpectedSafe ? "VULNERABLE" : "CRITICAL";
                    
                    const statusConfig = {
                        STABLE: { glow: "bg-emerald-400/10" },
                        VULNERABLE: { glow: "bg-amber-400/10" },
                        CRITICAL: { glow: "bg-rose-400/10" }
                    }[status];

                    return (
                        <>
                            <div className={`absolute top-0 right-0 w-48 h-48 rounded-full -mr-20 -mt-20 blur-3xl opacity-50 ${statusConfig.glow} pointer-events-none`} />
                            <RunwayMetric expectedWeek={expectedRunOutWeek} worstWeek={worstCaseRunOutWeek} />

                            {/* Scenario floor numbers — compact, below the metric */}
                            {(lowestExpected !== undefined || lowestWorst !== undefined) && (
                                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100">
                                    {lowestExpected !== undefined && (
                                        <div className="flex-1">
                                            <div className="flex items-center gap-1 mb-0.5">
                                                <p className="text-[8px] uppercase font-bold tracking-[0.2em] text-slate-400">Floor</p>
                                                <HelpBubble text="The lowest cash balance expected in the next 13 weeks, assuming average scenario outcomes." position="bottom-left" />
                                            </div>
                                            <p className={`text-sm font-bold font-financial tracking-tight ${lowestExpected < 0 ? "text-rose-600" : "text-slate-800"}`}>
                                                {fmt(lowestExpected)}
                                            </p>
                                        </div>
                                    )}
                                    {lowestWorst !== undefined && (
                                        <>
                                            <div className="w-px h-6 bg-slate-100" />
                                            <div className="flex-1">
                                                <div className="flex items-center gap-1 mb-0.5">
                                                    <p className="text-[8px] uppercase font-bold tracking-[0.2em] text-slate-400">Worst</p>
                                                    <HelpBubble text="The absolute minimum cash level predicted if the most pessimistic scenario plays out (e.g., major payment delays)." position="bottom-left" />
                                                </div>
                                                <p className={`text-sm font-bold font-financial tracking-tight ${lowestWorst < 0 ? "text-rose-500" : "text-slate-400"}`}>
                                                    {fmt(lowestWorst)}
                                                </p>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Drill-down portal — only when there's a gap to review */}
                            {onDrillIn && status !== "STABLE" && (
                                <button
                                    onClick={onDrillIn}
                                    className="mt-3 flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.2em] text-slate-900 hover:text-indigo-600 transition-colors group/drill"
                                >
                                    Review gap
                                    <ArrowRight className="w-3 h-3 group-hover/drill:translate-x-0.5 transition-transform" />
                                </button>
                            )}
                            {zoneBoundary && (
                                <p className="mt-1 text-[8px] font-bold uppercase tracking-[0.2em] text-slate-400">
                                    {zoneBoundary}
                                </p>
                            )}
                        </>
                    );
                })()}
            </div>
            </div>
            </div>
        </div>
    );
}
