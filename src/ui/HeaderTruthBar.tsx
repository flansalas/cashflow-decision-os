"use client";

import React, { useState, useEffect } from "react";
import { AlertTriangle, RotateCw, ChevronDown, ArrowRight, ListFilter, ClipboardList, TrendingUp, TrendingDown, Box, Settings2, Search, Trash2, CheckCircle2 } from "lucide-react";
import { RunwayMetric } from "./RunwayMetric";
import { HelpBubble } from "./HelpBubble";
import { GlobalSearch } from "./GlobalSearch";

function fmt(n: number): string {
    const sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
    inflow30: number;
    outflow30: number;
    isCompact?: boolean;
    companyName?: string;
    isCompanyDemo?: boolean;
    onDrillIn?: () => void;
    lowestExpected?: number;
    lowestWorst?: number;
    zoneBoundary?: string;
}

export function HeaderTruthBar({
    bankBalance, adjustmentsTotal, adjustedCash, buffer,
    confidence, lastUpdated, asOfDate, companyId,
    payroll, payrollPromptNeeded, adjustments, onUpdateBalanceClick, onBalanceUpdated,
    expectedRunOutWeek, worstCaseRunOutWeek, inflow30, outflow30, isCompact, companyName, isCompanyDemo,
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

    const isExpectedSafe = expectedRunOutWeek === null;
    const isWorstSafe = worstCaseRunOutWeek === null;
    const healthStatus = (isExpectedSafe && isWorstSafe) ? "STABLE" : isExpectedSafe ? "VULNERABLE" : "CRITICAL";

    return (
        <div className={`border shadow-sm bg-white relative flex flex-col z-[50] transition-all duration-500 ease-in-out ${isCompact ? 'rounded-2xl lg:rounded-full' : 'rounded-2xl'}`} style={{ borderColor: 'var(--border-default)' }}>
            <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
            
            {/* Top Row: Full Header / Command Strip Actions */}
            <div className={`transition-all duration-500 origin-top flex flex-col overflow-hidden ${isCompact ? 'max-h-0 opacity-0 pointer-events-none border-b-0' : 'max-h-24 opacity-100 pointer-events-auto border-b border-slate-100'}`}>
                <div className="flex items-center justify-between px-5 py-2.5 bg-slate-50/50 rounded-t-2xl">
                    <div className="flex items-center gap-2">
                        <span className="font-black text-xs tracking-[0.1em] flex items-center gap-2 text-slate-900 group cursor-default">
                            <Box className="w-5 h-5 text-indigo-600 transition-transform group-hover:scale-110" /> 
                            CF/D·OS
                        </span>
                        <span className="text-slate-300 mx-2 text-sm font-light">|</span>
                        <span className="font-black text-[11px] uppercase tracking-[0.15em] text-slate-700">
                            {companyName || "Casio and Sons Construction"}
                        </span>
                        {isCompanyDemo && (
                            <span className="px-2 py-0.5 ml-2 text-[8px] rounded border border-amber-200 bg-amber-50 text-amber-700 font-black uppercase tracking-[0.1em]">
                                Demo
                            </span>
                        )}
                        {/* {isStale && <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse ml-1" title="Bank data is stale" />} */}
                    </div>
                    <div className="flex items-center gap-3 relative z-20">

                        <button onClick={onUpdateBalanceClick} className="btn-pill !py-1 px-5 text-[11px] uppercase font-bold tracking-widest !bg-slate-900 !text-white !border-slate-900 hover:!bg-slate-800 h-8 shadow-sm flex items-center">
                            <RotateCw className="w-3 h-3 mr-1.5" /> Reconcile
                        </button>
                        <button onClick={() => setSearchOpen(true)} className="h-8 px-5 rounded-full text-[11px] font-bold uppercase tracking-widest bg-white border border-slate-200 hover:bg-slate-50 transition-colors flex items-center justify-center text-slate-600 shadow-sm" title="Search (Cmd+K)">
                            <Search className="w-3 h-3 mr-1.5" /> Search
                        </button>
                    </div>
                </div>
            </div>

            {/* Bottom Row: Pulse Metrics */}
            <div className={`flex flex-wrap lg:flex-nowrap items-center divide-y lg:divide-y-0 lg:divide-x divide-slate-100 relative z-10 transition-all duration-500 bg-white ${isCompact ? 'rounded-2xl lg:rounded-full px-2 py-1' : 'rounded-b-2xl'}`}>
                
                {/* Actions (Only visible in Compact View) */}
                <div className={`hidden lg:flex items-center overflow-hidden transition-all duration-500 ease-in-out ${isCompact ? 'w-auto opacity-100 pr-4' : 'w-0 opacity-0 pointer-events-none'}`}>
                    <div className="flex items-center gap-2 pl-3">
                        <span className="font-black text-[10px] uppercase tracking-[0.1em] text-slate-800 whitespace-nowrap pr-2 flex items-center gap-2">
                            <Box className="w-3 h-3 text-indigo-600" />
                            {companyName}
                        </span>

                        <div className="flex gap-1.5 border-l border-slate-200 pl-4 py-1">
                            <button onClick={onUpdateBalanceClick} className="btn-pill !py-0 px-2 text-[9px] uppercase font-bold tracking-widest !bg-slate-900 !text-white !border-slate-900 hover:!bg-slate-800 h-6 flex items-center shrink-0">
                                <RotateCw className="w-2 h-2 mr-1" /> Reconcile
                            </button>

                        </div>
                    </div>
                </div>

                {/* Cash */}
                <div className={`w-full lg:flex-1 flex items-center justify-between relative group/cash transition-all duration-500 ${isCompact ? 'px-3 py-2' : 'px-5 py-3'}`}>
                    <div className={`flex items-baseline w-full transition-all duration-500 ${isCompact ? 'gap-2' : 'gap-3'}`}>
                        <span className={`text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0 transition-all duration-500 ${isCompact ? 'w-10' : 'w-16'}`}>Cash</span>
                        <div className="flex flex-col items-start relative w-full">
                            <span 
                                onClick={() => setEditBalanceOpen(!editBalanceOpen)} 
                                className={`font-black font-financial cursor-pointer hover:text-indigo-600 border-b border-dashed border-slate-300 text-slate-900 transition-all duration-500 ${isCompact ? 'text-[15px]' : 'text-xl sm:text-2xl'}`}
                                title="Click to edit balance and outstanding items"
                            >
                                {fmt(adjustedCash)}
                            </span>
                            
                            {/* Adjusted/Muted details below */}
                            {adjustmentsTotal !== 0 && (
                                <button onClick={() => setShowAdj(!showAdj)} className={`font-medium text-slate-400 hover:text-slate-600 absolute flex items-center gap-1 opacity-80 group-hover/cash:opacity-100 transition-all duration-500 ${isCompact ? 'text-[8px] -bottom-2' : 'text-[9px] -bottom-3'}`}>
                                    <ListFilter className="w-2.5 h-2.5" />
                                    Includes {fmt(adjustmentsTotal)} adj.
                                </button>
                            )}
                            
                            {/* Fast Reconcile Popover */}
                            {editBalanceOpen && (
                                <>
                                    <div className="fixed inset-0 z-[50]" onClick={() => setEditBalanceOpen(false)} />
                                    <div className="absolute z-[60] top-full mt-4 w-80 border rounded-2xl p-5 shadow-2xl bg-white left-0 animate-in fade-in slide-in-from-top-2 border-slate-200">
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

                            {/* Adjustment breakdown Popover */}
                            {showAdj && (
                                <>
                                    <div className="fixed inset-0 z-[50]" onClick={() => setShowAdj(false)} />
                                    <div className="absolute z-[60] top-full mt-4 w-72 border rounded-xl p-5 shadow-2xl bg-white left-0 animate-in fade-in slide-in-from-top-2 border-slate-200">
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
                                                        <span className={`font-financial font-bold ${a.amount >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                            {a.amount >= 0 ? "+" : ""}{fmt(a.amount)}
                                                        </span>
                                                    </div>
                                                ))}
                                                <div className="pt-2 border-t mt-2 flex justify-between text-xs font-bold text-slate-900 uppercase tracking-wide">
                                                    <span>Calculated Start</span>
                                                    <span className="font-financial">{fmt(adjustedCash)}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Inflow */}
                <div className={`w-full lg:flex-1 flex items-center justify-between relative group/in transition-all duration-500 ${isCompact ? 'px-3 py-2' : 'px-5 py-3'}`}>
                    <div className={`flex items-baseline w-full transition-all duration-500 ${isCompact ? 'gap-2' : 'gap-3'}`}>
                        <span className={`text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0 transition-all duration-500 ${isCompact ? 'w-12' : 'w-16'}`}>In (30d)</span>
                        <div className="flex flex-col items-start relative w-full">
                            <span className={`font-black font-financial text-emerald-700 transition-all duration-500 ${isCompact ? 'text-[15px]' : 'text-xl sm:text-2xl'}`}>{fmt(inflow30)}</span>
                            <button onClick={() => setShowReasons(!showReasons)} className={`font-medium text-slate-400 hover:text-emerald-700 absolute flex items-center gap-1 opacity-80 group-hover/in:opacity-100 transition-all duration-500 whitespace-nowrap ${isCompact ? 'text-[8px] -bottom-2' : 'text-[9px] -bottom-3'}`}>
                                <TrendingUp className="w-2.5 h-2.5" />
                                {confidence.score}% Confidence
                            </button>

                            {/* Confidence Reasons Popover */}
                            {showReasons && (
                                <>
                                    <div className="fixed inset-0 z-[50]" onClick={() => setShowReasons(false)} />
                                    <div className="absolute z-[60] top-full mt-4 w-80 border rounded-xl p-5 shadow-2xl bg-white left-0 animate-in fade-in slide-in-from-top-2 border-slate-200">
                                        <div className="flex justify-between items-center mb-3">
                                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Inflow Quality Score</p>
                                            <button onClick={() => setShowReasons(false)} className="text-slate-300 hover:text-slate-600">&times;</button>
                                        </div>
                                        {confidence.reasons.map((r, i) => (
                                            <div key={i} className="text-xs mb-1.5 flex gap-2 text-slate-600">
                                                <span className="text-emerald-400 font-black">•</span> {r}
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Outflow */}
                <div className={`w-full lg:flex-1 flex items-center justify-between relative group/out transition-all duration-500 ${isCompact ? 'px-3 py-2' : 'px-5 py-3'}`}>
                    <div className={`flex items-baseline w-full transition-all duration-500 ${isCompact ? 'gap-2' : 'gap-3'}`}>
                        <span className={`text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0 transition-all duration-500 ${isCompact ? 'w-14' : 'w-16'}`}>Out (30d)</span>
                        <div className="flex flex-col items-start relative w-full">
                            <span className={`font-black font-financial text-rose-600 transition-all duration-500 ${isCompact ? 'text-[15px]' : 'text-xl sm:text-2xl'}`}>{fmt(outflow30)}</span>
                            {payroll ? (
                                <span className={`font-medium text-slate-400 absolute whitespace-nowrap flex items-center gap-1 opacity-80 group-hover/out:opacity-100 transition-all duration-500 ${isCompact ? 'text-[8px] -bottom-2' : 'text-[9px] -bottom-3.5'}`}>
                                    <TrendingDown className="w-2.5 h-2.5" />
                                    Payroll {new Date(payroll.nextDate!).toLocaleDateString(undefined, { month: 'short', day: 'numeric'})}
                                </span>
                            ) : payrollPromptNeeded ? (
                                <span className={`font-medium text-amber-600 absolute whitespace-nowrap flex items-center gap-1 opacity-80 group-hover/out:opacity-100 transition-all duration-500 ${isCompact ? 'text-[8px] -bottom-2' : 'text-[9px] -bottom-3.5'}`}>
                                    <AlertTriangle className="w-2.5 h-2.5" /> Payroll Info Missing
                                </span>
                            ) : null}
                        </div>
                    </div>
                </div>

                {/* Health & Runway */}
                <div className={`w-full lg:flex-[1.5] flex items-center justify-between relative group/health transition-all duration-500 ${isCompact ? 'px-3 py-2 lg:h-12 lg:rounded-r-full' : 'px-5 py-3 lg:min-w-[250px]'}`}>
                    {/* Contextual Action */}
                    <div className="relative z-10 flex shrink-0 items-center justify-start h-full">
                        {onDrillIn && healthStatus !== "STABLE" && (
                            <button
                                onClick={onDrillIn}
                                className={`flex items-center gap-1.5 font-black uppercase text-rose-600 hover:text-rose-700 hover:bg-rose-50/80 rounded transition-colors group/drill border border-transparent hover:border-rose-100 ${isCompact ? 'text-[9px] px-2 py-1' : 'tracking-[0.15em] text-[10px] px-3 py-1.5'}`}
                            >
                                Review Gap
                                <ArrowRight className="w-3 h-3 group-hover/drill:translate-x-0.5 transition-transform" />
                            </button>
                        )}
                    </div>

                    <div className="flex flex-col items-end justify-center w-full relative z-10 pt-2 lg:pt-0">
                        <RunwayMetric expectedWeek={expectedRunOutWeek} worstWeek={worstCaseRunOutWeek} isCompact={isCompact} />
                        
                        {(lowestExpected !== undefined || lowestWorst !== undefined) && (
                            <div className={`flex items-center justify-end gap-2 font-bold uppercase tracking-widest opacity-60 group-hover/health:opacity-100 transition-all duration-500 ${isCompact ? 'text-[8px] mt-0.5' : 'text-[9px] mt-1.5'}`}>
                                {lowestExpected !== undefined && (
                                    <span className="flex items-center gap-1 text-slate-500">
                                        Floor: <span className={`font-financial font-bold ${lowestExpected < 0 ? 'text-rose-600' : 'text-slate-700'}`}>{fmt(lowestExpected)}</span>
                                        <HelpBubble position="bottom-left" width="w-64" text="Lowest forecasted cash point across the entire 13-week expected projection." />
                                    </span>
                                )}
                                {lowestExpected !== undefined && lowestWorst !== undefined && <span className="text-slate-300">|</span>}
                                {lowestWorst !== undefined && (
                                    <span className="flex items-center gap-1 text-slate-500">
                                        Worst: <span className={`font-financial font-bold ${lowestWorst < 0 ? 'text-rose-600' : 'text-slate-700'}`}>{fmt(lowestWorst)}</span>
                                        <HelpBubble position="bottom-left" width="w-64" text="Lowest forecasted cash point if all identified worst-case risks materialize." />
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                    {/* Background glow color tint */}
                    {(() => {
                        const statusConfig = {
                            STABLE: { glow: "bg-emerald-400/5 lg:rounded-br-2xl" },
                            VULNERABLE: { glow: "bg-amber-400/10 lg:rounded-br-2xl" },
                            CRITICAL: { glow: "bg-rose-400/10 lg:rounded-br-2xl" }
                        }[healthStatus];
                        return <div className={`absolute inset-0 ${statusConfig.glow} pointer-events-none transition-all duration-500 ${isCompact ? 'rounded-2xl lg:rounded-r-full' : ''}`} />;
                    })()}
                </div>

                {/* End of compact actions -> if we also had 'Search', we'll add it on the right edge here */}
                {isCompact && (
                    <div className="hidden lg:flex items-center overflow-hidden transition-all duration-500 ml-1 pr-3">
                        <button onClick={() => setSearchOpen(true)} className="w-8 h-8 rounded-full border border-slate-200 hover:bg-slate-50 transition-colors flex items-center justify-center text-slate-600" title="Search (Cmd+K)">
                            <Search className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}

            </div>
        </div>
    );
}
