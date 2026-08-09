"use client";

import React, { useState, useEffect } from "react";
import { AlertTriangle, RotateCw, ChevronDown, ArrowRight, ListFilter, ClipboardList, TrendingUp, TrendingDown, Box, Settings2, Search, Trash2, CheckCircle2, ShieldCheck, ShieldAlert, CheckCircle2 as CheckCircle2Icon, AlertCircle, X, ChevronRight, Check, Calendar, Plus, Info, HelpCircle, FileText, Upload, Download, Copy, Printer } from "lucide-react";
import { RunwayMetric } from "./RunwayMetric";
import { HelpBubble } from "./HelpBubble";
import { GlobalSearch } from "./GlobalSearch";
import type { BusinessCashState, DataQualityGateResult } from "@/domain/types";

function fmt(n: number): string {
    const sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface Props {
    businessCashState: BusinessCashState;
    dataQualityGate: DataQualityGateResult | null;
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
    expectedEndingCash?: number;
    executionPlan?: {
        id: string;
        version: number;
        createdAt: string;
        approvedBy: string | null;
    } | null;
    postApprovalChanges?: Array<{
        id: string;
        createdAt: string;
        details: any;
    }>;
    forecastStateJson?: any;
    onPlanApproved?: () => void;
    onPrintPlan?: () => void;
    freshness?: {
        bankBalanceAsOf: string | null;
        bankLastImportedAt: string | null;
        arLastImportedAt: string | null;
        apLastImportedAt: string | null;
        forecastCalculatedAt: string;
    };
    managementImpact?: number;
}

const FRESHNESS_THRESHOLD_DAYS = 7;

function isStaleDate(dateStr: string | null): boolean {
    if (!dateStr) return true;
    const diffTime = Date.now() - new Date(dateStr).getTime();
    return diffTime > FRESHNESS_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
}

function formatFreshnessDate(dateStr: string | null): string {
    if (!dateStr) return "Not available";
    return new Date(dateStr).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true
    });
}

export function HeaderTruthBar({
    businessCashState, dataQualityGate, bankBalance, adjustmentsTotal, adjustedCash, buffer,
    confidence, lastUpdated, asOfDate, companyId,
    payroll, payrollPromptNeeded, adjustments, onUpdateBalanceClick, onBalanceUpdated,
    expectedRunOutWeek, worstCaseRunOutWeek, inflow30, outflow30, isCompact, companyName, isCompanyDemo,
    onDrillIn, lowestExpected, lowestWorst, zoneBoundary, expectedEndingCash,
    executionPlan, postApprovalChanges = [], forecastStateJson, onPlanApproved, onPrintPlan, freshness, managementImpact
}: Props) {
    const [showAdj, setShowAdj] = useState(false);
    const [showReasons, setShowReasons] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [showFreshnessMenu, setShowFreshnessMenu] = useState(false);

    const isFreshnessStale = !freshness ? false : (
        isStaleDate(freshness.bankLastImportedAt) ||
        isStaleDate(freshness.arLastImportedAt) ||
        isStaleDate(freshness.apLastImportedAt)
    );
    
    // Plan Approval
    const [isApproving, setIsApproving] = useState(false);
    const [approvalSuccess, setApprovalSuccess] = useState(false);
    const [showChangeSummary, setShowChangeSummary] = useState(false);

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

    const handleApprovePlan = async () => {
        setIsApproving(true);
        try {
            const res = await fetch("/api/execution-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    weekStart: forecastStateJson?.weeks?.[0]?.weekStart,
                    forecastStateJson
                }),
            });
            if (res.ok) {
                setApprovalSuccess(true);
                onPlanApproved?.();
            }
        } finally {
            setIsApproving(false);
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
    const healthStatus = businessCashState;

    return (
        <div className={`border shadow-sm bg-white relative flex flex-col z-[50] transition-all duration-500 ease-in-out ${isCompact ? 'rounded-2xl lg:rounded-full' : 'rounded-2xl'}`} style={{ borderColor: 'var(--border-default)' }}>
            <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
            
            {/* Top Row: Full Header / Command Strip Actions */}
            <div className={`transition-all duration-500 origin-top flex flex-col ${isCompact ? 'overflow-hidden max-h-0 opacity-0 pointer-events-none border-b-0' : 'overflow-visible max-h-24 opacity-100 pointer-events-auto border-b border-slate-100'}`}>
                <div className="flex items-center justify-between px-5 py-2.5 bg-slate-50/50 rounded-t-2xl">
                    <div className="flex items-center gap-2">
                        {isCompanyDemo && (
                            <span className="px-2 py-0.5 text-[8px] rounded border border-amber-200 bg-amber-50 text-amber-700 font-black uppercase tracking-[0.1em]">
                                Demo
                            </span>
                        )}
                        {freshness && (
                            <div className="relative ml-2 z-30">
                                <button
                                    onClick={() => setShowFreshnessMenu(!showFreshnessMenu)}
                                    className={`flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded border transition-colors ${
                                        isFreshnessStale
                                            ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                    }`}
                                >
                                    <span className={`w-1 h-1 rounded-full ${isFreshnessStale ? "bg-amber-500" : "bg-emerald-500"}`} />
                                    Data: {isFreshnessStale ? "Action Needed" : "Current"}
                                    <ChevronDown className="w-2.5 h-2.5" />
                                </button>
                                {showFreshnessMenu && (
                                    <>
                                        <div className="fixed inset-0 z-40" onClick={() => setShowFreshnessMenu(false)} />
                                        <div className="absolute left-0 mt-1.5 w-64 rounded-xl border p-4 shadow-xl bg-white z-50 animate-in fade-in slide-in-from-top-2 border-slate-200 text-slate-700 font-normal normal-case tracking-normal">
                                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-3 pb-1 border-b border-slate-100">Data Freshness Status</p>
                                            <div className="space-y-2.5 text-xs">
                                                <div>
                                                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Balance as of</p>
                                                    <p className="font-semibold text-slate-800">{formatFreshnessDate(freshness.bankBalanceAsOf)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Bank last imported</p>
                                                    <p className="font-semibold text-slate-800">{formatFreshnessDate(freshness.bankLastImportedAt)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">AR last imported</p>
                                                    <p className="font-semibold text-slate-800">{formatFreshnessDate(freshness.arLastImportedAt)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">AP last imported</p>
                                                    <p className="font-semibold text-slate-800">{formatFreshnessDate(freshness.apLastImportedAt)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">Forecast recalculated</p>
                                                    <p className="font-semibold text-slate-800">{formatFreshnessDate(freshness.forecastCalculatedAt)}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                        {/* {isStale && <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse ml-1" title="Bank data is stale" />} */}
                    </div>
                    {/* Global Search Bar (QBO Style) */}
                    <div className="hidden md:flex flex-1 max-w-md mx-4">
                        <button
                            onClick={() => setSearchOpen(true)}
                            className="w-full h-8 px-3 rounded-md bg-white border border-slate-200 hover:border-slate-300 transition-colors flex items-center justify-between text-slate-400 shadow-sm"
                        >
                            <div className="flex items-center">
                                <Search className="w-3.5 h-3.5 mr-2 text-slate-400" />
                                <span className="text-[11px] font-medium tracking-wide">Search transactions, invoices, or help...</span>
                            </div>
                            <kbd className="hidden sm:inline-block text-[9px] font-mono bg-slate-100 border border-slate-200 text-slate-500 font-bold px-1.5 py-0.5 rounded leading-none">
                                ⌘K
                            </kbd>
                        </button>
                    </div>

                    <div className="flex items-center gap-3 relative z-20 shrink-0">
                        {/* Mobile Search Icon (Shows only on small screens) */}
                        <button 
                            onClick={() => setSearchOpen(true)} 
                            className="md:hidden w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-600 shadow-sm"
                        >
                            <Search className="w-3.5 h-3.5" />
                        </button>
                        
                        {/* Plan Approval Status */}
                        {(approvalSuccess || (executionPlan && postApprovalChanges.length === 0)) ? (
                            <div className="hidden lg:flex items-center gap-2 mr-2">
                                <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1.5 px-3 py-1 bg-emerald-50 rounded-full border border-emerald-100 h-8">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Plan Approved
                                </span>
                                {onPrintPlan ? (
                                    <button 
                                        onClick={onPrintPlan}
                                        className="btn-pill !py-1 px-4 text-[11px] font-bold tracking-wider !bg-white !text-slate-700 !border-slate-300 hover:!bg-slate-50 hover:!text-slate-900 h-8 shadow-sm flex items-center gap-1.5 transition-colors"
                                    >
                                        <Printer className="w-3.5 h-3.5" />
                                        Print Execution Plan
                                    </button>
                                ) : (
                                    <a 
                                        href="/payables?printPlan=true"
                                        className="btn-pill !py-1 px-4 text-[11px] font-bold tracking-wider !bg-white !text-slate-700 !border-slate-300 hover:!bg-slate-50 hover:!text-slate-900 h-8 shadow-sm flex items-center gap-1.5 transition-colors"
                                    >
                                        <Printer className="w-3.5 h-3.5" />
                                        Print Execution Plan
                                    </a>
                                )}
                            </div>
                        ) : executionPlan ? (
                            <div className="hidden lg:flex items-center gap-3 mr-2">
                                <button 
                                    onClick={() => setShowChangeSummary(!showChangeSummary)}
                                    className="text-[10px] font-bold text-amber-600 hover:text-amber-700 hover:bg-amber-50 px-2 py-1 rounded transition-colors"
                                >
                                    {postApprovalChanges.length} change{postApprovalChanges.length === 1 ? '' : 's'} · ${Math.abs(postApprovalChanges.reduce((sum, c) => sum + (c.details.impact || 0), 0)).toLocaleString()}
                                </button>
                                <button 
                                    onClick={handleApprovePlan}
                                    disabled={isApproving}
                                    className="btn-pill !py-1 px-4 text-[11px] font-bold tracking-wider !bg-white !text-slate-800 !border-slate-300 hover:!bg-slate-50 h-8 shadow-sm flex items-center disabled:opacity-50"
                                >
                                    {isApproving ? "Approving..." : "Approve Revised"}
                                </button>
                            </div>
                        ) : (
                            <button 
                                onClick={handleApprovePlan}
                                disabled={isApproving}
                                className="hidden lg:flex btn-pill !py-1 px-5 text-[11px] font-bold tracking-wider !bg-indigo-600 !text-white !border-indigo-600 hover:!bg-indigo-700 h-8 shadow-sm items-center disabled:opacity-50"
                            >
                                {isApproving ? "Approving..." : "Approve Plan"}
                            </button>
                        )}

                        <button onClick={onUpdateBalanceClick} className="btn-pill !py-1 px-5 text-[11px] uppercase font-bold tracking-widest !bg-slate-900 !text-white !border-slate-900 hover:!bg-slate-800 h-8 shadow-sm flex items-center">
                            <RotateCw className="w-3 h-3 mr-1.5" /> Weekly Check-In
                        </button>
                    </div>

                    {/* Change Summary Popover */}
                    {showChangeSummary && postApprovalChanges.length > 0 && (
                        <>
                            <div className="fixed inset-0 z-[50]" onClick={() => setShowChangeSummary(false)} />
                            <div className="absolute z-[60] top-[60px] right-6 w-96 max-h-[80vh] overflow-y-auto border rounded-xl p-5 shadow-2xl bg-white animate-in fade-in slide-in-from-top-2 border-slate-200 custom-scrollbar">
                                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                                    <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Unapproved Changes</p>
                                    <button onClick={() => setShowChangeSummary(false)} className="text-slate-400 hover:text-slate-700 transition">&times;</button>
                                </div>
                                <div className="space-y-3">
                                    {postApprovalChanges.map(change => (
                                        <div key={change.id} className="text-xs p-3 rounded-lg border border-slate-100 bg-slate-50 flex justify-between items-start">
                                            <div className="flex flex-col gap-1 pr-4">
                                                <span className="font-bold text-slate-700">
                                                    {change.details.description || "Updated item"}
                                                </span>
                                                <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                                                    {new Date(change.createdAt).toLocaleString()}
                                                </span>
                                            </div>
                                            {change.details.impact !== undefined && (
                                                <span className={`font-financial font-bold whitespace-nowrap ${change.details.impact >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                                                    {change.details.impact >= 0 ? "+" : "–"}{fmt(Math.abs(change.details.impact))}
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
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

                        <div className="flex gap-2 border-l border-slate-200 pl-4 py-1">
                            <button onClick={onUpdateBalanceClick} className="btn-pill !py-0 px-3 text-[9px] uppercase font-bold tracking-widest !bg-slate-900 !text-white !border-slate-900 hover:!bg-slate-800 h-6 shadow-sm flex items-center shrink-0">
                                <RotateCw className="w-2.5 h-2.5 mr-1.5" /> Reconcile
                            </button>
                            <button onClick={() => setSearchOpen(true)} className="h-6 px-3 rounded-full border border-slate-200 flex items-center justify-center text-slate-600 bg-white hover:bg-slate-50 transition-colors shadow-sm" title="Search (Cmd+K)">
                                <Search className="w-2.5 h-2.5 mr-1.5" /> <span className="text-[9px] font-bold uppercase tracking-widest leading-none">Search</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Cash (Redesigned) */}
                <div className={`w-full lg:flex-[1.5] min-w-0 flex items-center justify-between relative group/cash transition-all duration-500 ${isCompact ? 'px-3 py-2' : 'px-4 xl:px-6 py-4'}`}>
                    <div className="flex flex-col items-start w-full min-w-0 gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 shrink-0">Starting Cash (As of {new Date(asOfDate).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'})})</span>
                        <div className="flex items-center gap-3 w-full min-w-0 flex-wrap">
                            <span className={`font-black font-financial text-slate-900 transition-all duration-500 truncate max-w-full block ${isCompact ? 'text-[15px]' : 'text-2xl xl:text-3xl'}`}>
                                {fmt(adjustedCash)}
                            </span>
                            <button 
                                onClick={() => setEditBalanceOpen(!editBalanceOpen)} 
                                className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-widest bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-md transition-colors"
                            >
                                ✎ Reconcile Starting Cash
                            </button>
                        </div>
                        
                        {/* Adjusted/Muted details below */}
                        <div className={`font-medium text-slate-500 flex items-center flex-wrap gap-2 transition-all duration-500 mt-1 ${isCompact ? 'text-[9px]' : 'text-[11px]'}`}>
                            <span className="opacity-80">Stated Bank: {fmt(bankBalance)}</span>
                            {adjustmentsTotal !== 0 && (
                                <>
                                    <span className="opacity-80">•</span>
                                    <button onClick={() => setShowAdj(!showAdj)} className="hover:text-slate-700 font-bold flex items-center gap-1 opacity-80 group-hover/cash:opacity-100 transition-opacity">
                                        <ListFilter className="w-2.5 h-2.5" />
                                        Uncleared Items: {fmt(adjustmentsTotal)}
                                    </button>
                                </>
                            )}
                        </div>
                        
                        {/* Fast Reconcile Popover */}
                        {editBalanceOpen && (
                            <>
                                <div className="fixed inset-0 z-[50]" onClick={() => setEditBalanceOpen(false)} />
                                <div className="absolute z-[60] top-full mt-4 w-80 border rounded-2xl p-5 shadow-2xl bg-white left-0 animate-in fade-in slide-in-from-top-2 border-slate-200">
                                    <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-3">
                                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-500">Adjust Starting Cash</p>
                                        <button onClick={() => setEditBalanceOpen(false)} className="text-slate-400 hover:text-slate-700 transition">&times;</button>
                                    </div>
                                    
                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Stated Bank Balance</label>
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
                                                <label className="text-[10px] uppercase tracking-wider text-slate-500 block mb-1">Uncleared Items (Click to Edit)</label>
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
                                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Uncleared Items</p>
                                        <button onClick={() => setShowAdj(false)} className="text-slate-300 hover:text-slate-600">&times;</button>
                                    </div>
                                    {adjustments.length === 0 ? (
                                        <p className="text-xs italic text-slate-400">No pending items</p>
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

                {/* Adaptive Health Widget */}
                <div className={`w-full lg:flex-[1.5] min-w-0 flex items-center relative transition-all duration-500 gap-4 ${isCompact ? 'px-3 py-2 lg:h-12 lg:rounded-r-full' : 'px-4 py-4 xl:px-6 lg:rounded-br-2xl'} ${
                    lowestExpected !== undefined && lowestExpected < 0 ? 'bg-rose-50 border-l-4 border-rose-400' :
                    lowestExpected !== undefined && lowestExpected < buffer ? 'bg-amber-50 border-l-4 border-amber-400' :
                    lowestExpected !== undefined && lowestExpected > buffer * 2 ? 'bg-blue-50 border-l-4 border-blue-400' :
                    'bg-emerald-50 border-l-4 border-emerald-400'
                }`}>
                    {(() => {
                        const lowest = lowestExpected !== undefined ? lowestExpected : 0;
                        const isCritical = lowest < 0;
                        const isWarning = lowest >= 0 && lowest < buffer;
                        const isExcess = lowest > buffer * 2;
                        
                        let adaptiveStatus = "STABLE";
                        let adaptiveColor = "text-emerald-700";
                        let adaptiveIcon = <CheckCircle2 className="w-5 h-5 lg:w-6 lg:h-6 text-emerald-500" />;
                        let adaptiveSubtext = `Lowest expected cash is ${fmt(lowest)}, safely above your ${fmt(buffer)} buffer.`;
                        let adaptiveAction = "View Trend";
                        let adaptiveActionColor = "text-emerald-700 bg-emerald-100 hover:bg-emerald-200";

                        if (isCritical) {
                            adaptiveStatus = "CRITICAL RUNWAY";
                            adaptiveColor = "text-rose-700";
                            adaptiveIcon = <AlertTriangle className="w-5 h-5 lg:w-6 lg:h-6 text-rose-500" />;
                            adaptiveSubtext = `Cash drops below $0 on Week ${expectedRunOutWeek || '?'}. Immediate action required.`;
                            adaptiveAction = "Fix Shortfall";
                            adaptiveActionColor = "text-white bg-rose-600 hover:bg-rose-700";
                        } else if (isWarning) {
                            adaptiveStatus = "WARNING";
                            adaptiveColor = "text-amber-700";
                            adaptiveIcon = <AlertTriangle className="w-5 h-5 lg:w-6 lg:h-6 text-amber-500" />;
                            adaptiveSubtext = `Lowest cash (${fmt(lowest)}) drops below your ${fmt(buffer)} safety buffer.`;
                            adaptiveAction = "Review Gap";
                            adaptiveActionColor = "text-amber-800 bg-amber-200 hover:bg-amber-300";
                        } else if (isExcess) {
                            adaptiveStatus = "EXCESS RESERVES";
                            adaptiveColor = "text-blue-700";
                            adaptiveIcon = <TrendingUp className="w-5 h-5 lg:w-6 lg:h-6 text-blue-500" />;
                            adaptiveSubtext = `${fmt(lowest - buffer)} above your required safety buffer over the next 13 weeks.`;
                            adaptiveAction = "Explore";
                            adaptiveActionColor = "text-blue-800 bg-blue-200 hover:bg-blue-300";
                        }

                        return (
                            <>
                                <div className="shrink-0 pt-0.5">
                                    {adaptiveIcon}
                                </div>
                                <div className="flex flex-col items-start min-w-0 flex-1 justify-center gap-1">
                                    <div className="flex items-center gap-3 w-full flex-wrap lg:flex-nowrap justify-between">
                                        <span className={`font-black uppercase tracking-widest text-[11px] lg:text-xs ${adaptiveColor}`}>
                                            {adaptiveStatus}
                                        </span>
                                        {onDrillIn && (
                                            <button
                                                onClick={onDrillIn}
                                                className={`flex items-center gap-1.5 font-bold uppercase rounded-md transition-colors shadow-sm tracking-wider text-[10px] px-3 py-1.5 shrink-0 ${adaptiveActionColor}`}
                                            >
                                                {adaptiveAction}
                                                <ArrowRight className="w-3 h-3" />
                                            </button>
                                        )}
                                    </div>
                                    {!isCompact && (
                                        <span className="text-[10px] lg:text-[11px] font-medium text-slate-600 leading-snug max-w-[90%]">
                                            {adaptiveSubtext}
                                        </span>
                                    )}
                                </div>
                            </>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
}
