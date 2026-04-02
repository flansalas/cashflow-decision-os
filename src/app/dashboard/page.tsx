// Dashboard page component – renders the Survival Dashboard
"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { HeaderTruthBar } from "@/ui/HeaderTruthBar";
import { ForecastChart } from "@/ui/ForecastChart";
import { ForecastRunwayView } from "@/ui/ForecastRunwayView";
import { ForecastPulseView } from "@/ui/ForecastPulseView";
import { ForecastActionsView } from "@/ui/ForecastActionsView";
import { ForecastSummaryGrid } from "@/ui/ForecastSummaryGrid";
import { ActionsPanel } from "@/ui/ActionsPanel";
import { WhyWeekModal } from "@/ui/WhyWeekModal";
import { OnboardingWizard } from "@/ui/OnboardingWizard";
import { ScenarioBuilder, type ScenarioItem } from "@/ui/ScenarioBuilder";
import { ForecastBarView } from "@/ui/ForecastBarView";
import { BacklogTriage, type BacklogData } from "@/ui/BacklogTriage";
import { UpdateBalanceDialog } from "@/ui/UpdateBalanceDialog";
import { GettingStartedTracker } from "@/ui/GettingStartedTracker";
import { SpotlightProvider } from "@/ui/SpotlightContext";
import { NebulaOverlay } from "@/ui/NebulaOverlay";
import { RiskOptimismDial } from "@/ui/RiskOptimismDial";
import { AlertTriangle, Settings2, BarChart3, Target, PlaneTakeoff, AlignEndHorizontal, Zap, ClipboardList, Lightbulb, ChevronDown, ArrowRight, LineChart, Box, ArrowLeft, Upload, Landmark, RefreshCw, X, CheckCircle, ThermometerSun, ShieldCheck, ShieldAlert } from "lucide-react";

interface DashboardData {
    company: { id: string; name: string; isDemo: boolean };
    cash: {
        bankBalance: number;
        adjustmentsTotal: number;
        adjustedOpeningCash: number;
        asOfDate: string;
        adjustments: Array<{ id: string; type: string; amount: number; note: string | null }>;
    };
    assumptions: {
        bufferMin: number;
        payrollCadence: string;
        payrollAllInAmount: number | null;
        payrollNextDate: string | null;
        fixedWeeklyOutflow: number;
        projectionSafetyMargin: number;
    };
    payroll: {
        nextDate: string | null;
        amount: number;
        confidence: string;
        source: string;
    } | null;
    payrollPromptNeeded: boolean;
    forecast: {
        weeks: Array<{
            weekNumber: number;
            weekStart: string;
            weekEnd: string;
            startCash: number;
            endCashExpected: number;
            endCashBest: number;
            endCashWorst: number;
            inflowsExpected: number;
            outflowsExpected: number;
            inflowsBest: number;
            outflowsBest: number;
            inflowsWorst: number;
            outflowsWorst: number;
            zone: string;
            confidenceScore: number;
            breakdown: {
                inflows: Array<{
                    label: string;
                    amount: number;
                    type: string;
                    sourceType: string;
                    confidence: string;
                    section?: string;
                }>;
                outflows: Array<{
                    label: string;
                    amount: number;
                    type: string;
                    sourceType: string;
                    confidence: string;
                    section?: string;
                }>;
            };
            worstCaseDriver: string | null;
        }>;
        constraintWeek: number | null;
        worstCaseConstraintWeek: number | null;
        expectedRunOutWeek: number | null;
        worstCaseRunOutWeek: number | null;
        lowestExpectedBalance: number;
        lowestWorstBalance: number;
    };
    confidence: { score: number; label: string; reasons: string[] };
    anomalies: Array<{ id: string; type: string; severity: string; message: string }>;
    anomalyCount: number;
    actions: Array<{
        type: string;
        priority: string;
        title: string;
        description: string;
        amountImpact: number;
        impactCertainty: string;
        targetType: string;
        targetId: string | null;
    }>;
    commitments: Array<{
        id: string;
        displayName: string;
        category: string;
        cadence: string;
        nextExpectedDate: string | null;
        typicalAmount: number;
        confidence: string;
        isCritical: boolean;
        direction: string;
    }>;
    commitmentsCount: number;
    cashFlowCategories?: Array<{ id: string; name: string; direction: string }>;
    zoneBoundary: string;
    lastUpdated: string;
    onboardingCompleted?: boolean;
    backlog: BacklogData;
}

function DashboardContent() {
    const searchParams = useSearchParams();
    const urlCompanyId = searchParams.get("companyId");
    const [companyId, setCompanyId] = useState<string | null>(null);
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [whyWeekOpen, setWhyWeekOpen] = useState(false);
    const [selectedWeekNumber, setSelectedWeekNumber] = useState<number | null>(null);
    const [setupOpen, setSetupOpen] = useState(false);
    const [scenarioItems, setScenarioItems] = useState<ScenarioItem[]>([]);
    const [forecastView, setForecastView] = useState<"actions" | "chart" | "runway" | "pulse" | "bar">("chart");
    const [showUpdateBalance, setShowUpdateBalance] = useState(false);
    // Map from weekNumber → change in endCashExpected vs last saved snapshot (positive = improved)
    const [forecastDiff, setForecastDiff] = useState<Map<number, number>>(new Map());
    const [isScrolled, setIsScrolled] = useState(false);
    const otherViewsRef = useRef<HTMLDetailsElement>(null);

    // Scroll listener for sticky header morphing
    useEffect(() => {
        const handleScroll = () => {
            const currentScrollY = window.scrollY;
            if (currentScrollY > 40 && !isScrolled) setIsScrolled(true);
            if (currentScrollY <= 40 && isScrolled) setIsScrolled(false);
        };
        window.addEventListener("scroll", handleScroll, { passive: true });
        return () => window.removeEventListener("scroll", handleScroll);
    }, [isScrolled]);

    // The effective companyId to pass to sub-components (resolved eagerly for the wizard guard)
    const effectiveCompanyId = companyId ?? urlCompanyId ?? (typeof window !== "undefined" ? localStorage.getItem("cfdo_company_id") : null);

    // Resolve companyId: URL param > localStorage > default (demo)
    useEffect(() => {
        if (urlCompanyId) {
            localStorage.setItem("cfdo_company_id", urlCompanyId);
            setCompanyId(urlCompanyId);
        } else {
            const saved = localStorage.getItem("cfdo_company_id");
            setCompanyId(saved ?? null);
        }
    }, [urlCompanyId]);

    const fetchDashboard = (cid?: string | null) => {
        const id = cid ?? companyId;
        const url = id ? `/api/dashboard?companyId=${id}` : "/api/dashboard";
        fetch(url)
            .then(r => r.json())
            .then(d => {
                if (d.error) {
                    setError(d.error);
                } else {
                    console.log("Dashboard Commitments:", d.commitments);
                    setData(d);
                    
                    try {
                        localStorage.setItem('cfdo_company_name', d.company.name);
                        localStorage.setItem('cfdo_is_demo', String(d.company.isDemo));
                    } catch { /* noop */ }

                    // ── What changed since last visit ─────────────────────────
                    const SNAPSHOT_KEY = `cfdo_forecast_snapshot_${id ?? "demo"}`;
                    try {
                        const raw = localStorage.getItem(SNAPSHOT_KEY);
                        if (raw) {
                            const prev: Record<number, number> = JSON.parse(raw);
                            const diff = new Map<number, number>();
                            for (const w of d.forecast.weeks) {
                                const prevCash = prev[w.weekNumber];
                                if (prevCash !== undefined) {
                                    const change = w.endCashExpected - prevCash;
                                    // Only surface meaningful changes (>= 1% of the absolute value or $500)
                                    if (Math.abs(change) >= Math.max(500, Math.abs(prevCash) * 0.01)) {
                                        diff.set(w.weekNumber, change);
                                    }
                                }
                            }
                            setForecastDiff(diff);
                        }
                        // Save new snapshot
                        const snapshot: Record<number, number> = {};
                        for (const w of d.forecast.weeks) snapshot[w.weekNumber] = w.endCashExpected;
                        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
                    } catch { /* localStorage not available */ }
                }
                setLoading(false);
            })
            .catch(() => {
                setError("Failed to load dashboard");
                setLoading(false);
            });
    };

    useEffect(() => {
        if (companyId !== null) fetchDashboard(companyId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId]);

    // Setup Wizard Listener
    useEffect(() => {
        const handleOpenSetup = () => setSetupOpen(true);
        window.addEventListener('open-setup', handleOpenSetup);
        
        if (searchParams.get('setup') === 'true') {
            setSetupOpen(true);
            window.history.replaceState({}, '', '/dashboard');
        }
        
        return () => window.removeEventListener('open-setup', handleOpenSetup);
    }, [searchParams]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
                <div className="text-center space-y-4">
                    <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full mx-auto" />
                    <p style={{ color: 'var(--text-muted)' }} className="text-sm tracking-wide">Loading forecast…</p>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
                <div className="border rounded-xl p-8 max-w-md text-center" style={{ background: '#fff5f5', borderColor: 'rgba(220,38,38,0.25)' }}>
                    <p style={{ color: '#dc2626' }} className="text-base font-medium mb-3 flex items-center justify-center gap-2">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" /> {error}
                    </p>
                    <a href="/" style={{ color: 'var(--color-primary)' }} className="hover:underline text-sm">Back to Home</a>
                </div>
            </div>
        );
    }



    const constraintWeekData = data.forecast.constraintWeek
        ? data.forecast.weeks[data.forecast.constraintWeek - 1]
        : null;

    const isSetupIncomplete = data.onboardingCompleted === false;

    return (
        <div className="min-h-screen overflow-visible" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>

            {/* STICKY TOP CONTAINER: Unified "Morphing" Header */}
            <div 
                className={`sticky top-0 z-50 transition-all duration-300 ease-in-out border-b ${isScrolled ? 'py-3 shadow-md bg-white/95 backdrop-blur-md px-6' : 'py-5 bg-slate-50/50 backdrop-blur-sm px-6'}`} 
                style={{ borderColor: 'var(--border-subtle)' }}
            >
                <div className="max-w-[88rem] mx-auto flex flex-col">
                    {/* The Ribbon: Morphs based on isScrolled */}
                    <HeaderTruthBar
                        isCompact={isScrolled}
                        companyName={data.company.name}
                        isCompanyDemo={data.company.isDemo}
                        bankBalance={data.cash.bankBalance}
                        adjustmentsTotal={data.cash.adjustmentsTotal}
                        adjustedCash={data.cash.adjustedOpeningCash}
                        buffer={data.assumptions.bufferMin}
                        confidence={data.confidence}
                        lastUpdated={data.lastUpdated}
                        asOfDate={data.cash.asOfDate}
                        companyId={data.company.id}
                        payroll={data.payroll}
                        payrollPromptNeeded={data.payrollPromptNeeded}
                        adjustments={data.cash.adjustments}
                        onUpdateBalanceClick={() => setShowUpdateBalance(true)}
                        onBalanceUpdated={() => {
                            fetchDashboard(effectiveCompanyId);
                        }}
                        expectedRunOutWeek={data.forecast.expectedRunOutWeek}
                        worstCaseRunOutWeek={data.forecast.worstCaseRunOutWeek}
                        inflow30={data.forecast.weeks.slice(0, 4).reduce((s, w) => s + w.inflowsExpected, 0)}
                        outflow30={data.forecast.weeks.slice(0, 4).reduce((s, w) => s + w.outflowsExpected, 0)}
                        onDrillIn={data.forecast.constraintWeek ? () => setSelectedWeekNumber(data.forecast.constraintWeek!) : undefined}
                        lowestExpected={data.forecast.lowestExpectedBalance}
                        lowestWorst={data.forecast.lowestWorstBalance}
                        zoneBoundary={data.zoneBoundary}
                    />
                </div>
            </div>

            <main className="max-w-[88rem] mx-auto px-6 py-6 space-y-6">
                {/* ── Dashboard Pulse Grid ─────────────────────────── */}
                <div className="flex flex-col gap-5">
                    {/* FULL WIDTH: The Pulse (Chart) */}
                    <div className="flex flex-col bg-white border rounded-2xl shadow-sm overflow-visible" style={{ borderColor: 'var(--border-default)' }}>
                        
                        {/* INTEGRATED TOOLBAR */}
                        <div className="px-6 py-2 border-b bg-slate-50/50 flex flex-wrap items-center justify-between gap-4 rounded-t-2xl" style={{ borderColor: 'var(--border-subtle)' }}>
                            <div className="flex items-center gap-3">
                                {/* Unified View Segmented Control */}
                                <div className="flex items-center p-1 bg-white border shadow-sm rounded-[10px]" style={{ borderColor: "var(--border-subtle)" }}>
                                    {([
                                        { id: "chart",   icon: <LineChart className="w-3.5 h-3.5" />, label: "Chart",   title: "Trend over time" },
                                        { id: "actions", icon: <Target className="w-3.5 h-3.5" />, label: "Actions", title: "Card views + Inline fixes" },
                                        { id: "runway",  icon: <PlaneTakeoff className="w-3.5 h-3.5" />, label: "Runway",  title: "Health strip" },
                                        { id: "bar",   icon: <BarChart3 className="w-3.5 h-3.5" />, label: "Cash Flow",  title: "Inflow vs Outflow grid" },
                                        { id: "pulse", icon: <AlignEndHorizontal className="w-3.5 h-3.5" />, label: "Waterfall", title: "Pacing details" },
                                    ] as const).map(v => (
                                        <button
                                            key={v.id}
                                            onClick={() => setForecastView(v.id)}
                                            title={v.title}
                                            className={`px-3 py-1.5 rounded-[6px] text-xs font-bold transition-all flex items-center gap-2 whitespace-nowrap shrink-0 ${forecastView === v.id ? "shadow-sm ring-1 ring-black/5" : "hover:bg-slate-50"}`}
                                            style={forecastView === v.id
                                                ? { background: "var(--color-primary)", color: "#ffffff" }
                                                : { color: "var(--text-muted)" }}
                                        >
                                            {v.icon} <span className="hidden md:inline">{v.label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                            
                            {/* Simulation Controls Right-Aligned */}
                            <div className="flex items-center">
                                <RiskOptimismDial 
                                    companyId={effectiveCompanyId ?? ""}
                                    initialMargin={data.assumptions.projectionSafetyMargin}
                                    onChanged={() => fetchDashboard(effectiveCompanyId)}
                                />
                            </div>
                        </div>

                        {/* Active view Workspace */}
                        <div key={forecastView} className="view-enter px-6 pb-6 pt-4 min-h-[500px] bg-white flex flex-col flex-1">
                            {forecastView === "actions" && (
                                <ForecastActionsView
                                    weeks={data.forecast.weeks}
                                    buffer={data.assumptions.bufferMin}
                                    constraintWeek={data.forecast.constraintWeek}
                                    scenarioItems={scenarioItems}
                                    companyId={effectiveCompanyId ?? ""}
                                    onWeekClick={wn => setSelectedWeekNumber(wn)}
                                    onActioned={() => fetchDashboard()}
                                />
                            )}
                            {forecastView === "chart" && (
                                <ForecastChart
                                    weeks={data.forecast.weeks}
                                    buffer={data.assumptions.bufferMin}
                                    constraintWeek={data.forecast.constraintWeek}
                                    scenarioItems={scenarioItems}
                                    onWeekClick={wn => setSelectedWeekNumber(wn)}
                                />
                            )}
                            {forecastView === "runway" && (
                                <ForecastRunwayView
                                    weeks={data.forecast.weeks}
                                    buffer={data.assumptions.bufferMin}
                                    constraintWeek={data.forecast.constraintWeek}
                                    scenarioItems={scenarioItems}
                                    forecastDiff={forecastDiff}
                                    onWeekClick={wn => setSelectedWeekNumber(wn)}
                                />
                            )}
                            {forecastView === "bar" && (
                                <ForecastBarView
                                    weeks={data.forecast.weeks}
                                    buffer={data.assumptions.bufferMin}
                                    constraintWeek={data.forecast.constraintWeek}
                                    scenarioItems={scenarioItems}
                                    onWeekClick={wn => setSelectedWeekNumber(wn)}
                                />
                            )}
                            {forecastView === "pulse" && (
                                <ForecastPulseView
                                    weeks={data.forecast.weeks}
                                    buffer={data.assumptions.bufferMin}
                                    constraintWeek={data.forecast.constraintWeek}
                                    scenarioItems={scenarioItems}
                                    onWeekClick={wn => setSelectedWeekNumber(wn)}
                                />
                            )}
                        </div>
                    </div>
                </div>

                {/* ── Getting Started Checklist (only when setup incomplete) ── */}
                {(() => {
                    const hasBalance = data.cash.bankBalance > 0;
                    const hasPayroll = data.payroll !== null;
                    const hasCommitments = data.commitmentsCount > 1;
                    const hasARAPData = (data.backlog.overdueAP.length + data.backlog.overdueAR.length) > 0;
                    const hasBuffer = data.assumptions.bufferMin > 0;
                    const isAllDone = hasBalance && hasPayroll && hasCommitments && hasARAPData && hasBuffer;
                    if (isAllDone) return null;
                    return (
                        <details className="rounded-2xl border overflow-hidden shadow-sm group transition-shadow hover:shadow-[0_8px_16px_rgba(15,23,42,0.04)]" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                            <summary className="px-6 py-4 cursor-pointer text-xs font-semibold uppercase tracking-wider select-none flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                                <span className="flex items-center gap-2">
                                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                                    Setup Checklist
                                </span>
                                <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" />
                            </summary>
                            <div className="px-5 py-4 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                                <GettingStartedTracker
                                    companyId={data.company.id}
                                    hasBalance={hasBalance}
                                    hasPayroll={hasPayroll}
                                    hasCommitments={hasCommitments}
                                    hasARAPData={hasARAPData}
                                    hasBuffer={hasBuffer}
                                    onOpenSetup={() => setSetupOpen(true)}
                                    onOpenCommitments={() => window.location.href = "/recurring"}
                                />
                            </div>
                        </details>
                    );
                })()}

                {/* ── 13-Week Forecast Summary Grid ─────────── */}
                <details className="rounded-2xl border overflow-hidden shadow-sm group transition-shadow hover:shadow-[0_8px_16px_rgba(15,23,42,0.04)]" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                    <summary className="px-6 py-4 cursor-pointer text-xs font-semibold uppercase tracking-wider select-none flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                        <span className="flex items-center gap-2">
                            <ClipboardList className="w-4 h-4 text-slate-400" />
                            13-Week Detailed Forecast Table
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        <ForecastSummaryGrid 
                            forecast={data.forecast} 
                            categories={data.cashFlowCategories || []} 
                            onCellClick={(type, week, extraId) => {
                                if (type === "ar" || type === "ap") {
                                    window.location.href = `/cashflow?mode=${type}&highlightWeek=${week}`;
                                } else if (type === "recurring" || type === "recurring-in" || type === "recurring-payroll") {
                                    window.location.href = `/recurring?highlightWeek=${week}`;
                                } else if (type === "cash-adjustments") {
                                    const dir = data.cashFlowCategories?.find(c => c.id === extraId)?.direction === "inflow" ? "in" : "out";
                                    window.location.href = `/cash-adjustments?direction=${dir}&highlightWeek=${week}&highlightCategory=${extraId}`;
                                }
                            }}
                        />
                    </div>
                </details>

                {/* ── Zone 5: Lab — Scenario Builder ──────────────────────────── */}
                <details className="rounded-2xl border overflow-hidden shadow-sm group transition-shadow hover:shadow-[0_8px_16px_rgba(15,23,42,0.04)]" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                    <summary className="px-6 py-4 cursor-pointer text-xs font-semibold uppercase tracking-wider select-none flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                        <span className="flex items-center gap-2">
                            <Lightbulb className="w-4 h-4 text-indigo-400" />
                            Lab: Scenario Builder & What-Ifs
                        </span>
                        <ChevronDown className="w-3.5 h-3.5 group-open:rotate-180 transition-transform" />
                    </summary>
                    <div className="px-5 pb-5 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                        <ScenarioBuilder
                            companyId={effectiveCompanyId ?? ""}
                            weeks={data.forecast.weeks.map(w => ({ weekNumber: w.weekNumber, weekEnd: w.weekEnd }))}
                            items={scenarioItems}
                            onAdd={item => setScenarioItems(prev => [...prev, item])}
                            onUpdate={item => setScenarioItems(prev => prev.map(i => i.id === item.id ? item : i))}
                            onRemove={id => setScenarioItems(prev => prev.filter(i => i.id !== id))}
                            onClear={() => setScenarioItems([])}
                            onLoad={items => setScenarioItems(items)}
                        />
                    </div>
                </details>

                {/* ── Zone 6: Execution — Actions (collapsed by default, full list) ─ */}
                <details className="rounded-2xl border overflow-hidden shadow-sm transition-shadow hover:shadow-[0_8px_16px_rgba(15,23,42,0.04)]" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                    <summary className="px-6 py-4 cursor-pointer text-xs font-semibold uppercase tracking-wider select-none flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                        <span className="flex items-center gap-2">
                            <ClipboardList className="w-4 h-4 text-slate-400" />
                            What Moves the Needle — All Actions
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full border flex items-center gap-1" style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}>
                            {data.actions.length} actions <ChevronDown className="w-3 h-3" />
                        </span>
                    </summary>
                    <div className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
                        <ActionsPanel actions={data.actions} />
                    </div>
                </details>

                {data.anomalyCount > 0 && (
                    <details className="border rounded-2xl shadow-sm overflow-hidden transition-shadow hover:shadow-[0_8px_16px_rgba(15,23,42,0.04)]" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                        <summary className="px-6 py-4 cursor-pointer text-xs font-semibold uppercase tracking-wider text-rose-600 hover:text-rose-500 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" /> Data Anomalies ({data.anomalyCount})
                        </summary>
                        <div className="px-5 pb-4 space-y-2">
                            {data.anomalies.map(a => (
                                <div key={a.id} className="text-sm text-[#94a3b8] py-1 border-t" style={{ borderColor: "var(--border-subtle)" }}>
                                    {a.message}
                                </div>
                            ))}
                        </div>
                    </details>
                )}

                {data.company.isDemo && (
                    <div className="border rounded-xl shadow-sm overflow-hidden p-4 text-center flex items-center justify-center gap-2" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                        <Lightbulb className="w-4 h-4 text-indigo-400 shrink-0" />
                        <p style={{ color: 'var(--text-muted)' }} className="text-sm">
                            <strong style={{ color: 'var(--text-primary)' }}>Try a scenario:</strong>{" "}
                            Use the Scenario Builder above to model a cash injection or deferred payment.
                        </p>
                    </div>
                )}
            </main>

            {/* Week Detail Modal — opens for any clicked week */}
            {selectedWeekNumber !== null && (() => {
                const selectedWeek = data.forecast.weeks[selectedWeekNumber - 1];
                return selectedWeek ? (
                    <WhyWeekModal
                        week={selectedWeek}
                        weekNumber={selectedWeekNumber}
                        weekStart={selectedWeek.weekStart}
                        companyId={effectiveCompanyId ?? ""}
                        scenarioItems={scenarioItems}
                        viewMode={forecastView === "actions" || forecastView === "bar" ? "chart" : forecastView}
                        buffer={data.assumptions.bufferMin}
                        onReschedule={() => { setSelectedWeekNumber(null); fetchDashboard(); }}
                        onNavigateWeek={(delta) => {
                            const newNum = selectedWeekNumber + delta;
                            if (newNum >= 1 && newNum <= data.forecast.weeks.length) {
                                setSelectedWeekNumber(newNum);
                            }
                        }}
                        onClose={() => setSelectedWeekNumber(null)}
                    />
                ) : null;
            })()}

            {/* Setup Wizard (openable from header or banner) */}
            {setupOpen && effectiveCompanyId && (
                <OnboardingWizard
                    companyId={effectiveCompanyId}
                    startStep={0}
                    onClose={() => { setSetupOpen(false); fetchDashboard(); }}
                />
            )}
            {showUpdateBalance && data && (
                <UpdateBalanceDialog
                    currentBalance={data.cash.bankBalance}
                    currentAdjustments={data.cash.adjustments}
                    companyId={data.company.id}
                    onSaved={() => {
                        setShowUpdateBalance(false);
                        fetchDashboard(effectiveCompanyId);
                    }}
                    onCancel={() => setShowUpdateBalance(false)}
                />
            )}
        </div>
    );
}

export default function DashboardPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
                <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full" />
            </div>
        }>
            <SpotlightProvider>
                <DashboardContent />
                <NebulaOverlay />
            </SpotlightProvider>
        </Suspense>
    );
}
