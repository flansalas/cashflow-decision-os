"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuth, useOrganization } from "@clerk/nextjs";
import {
    CheckCircle2, AlertTriangle, TrendingUp, TrendingDown, ArrowRight,
    Calendar, Check, ShieldCheck, HelpCircle, FileText, ChevronDown
} from "lucide-react";
import { HelpBubble } from "@/ui/HelpBubble";
import { UpdateBalanceDialog } from "@/ui/UpdateBalanceDialog";
import { VarianceDriverPanel } from "@/ui/VarianceDriverPanel";
import type { VarianceDriverResult } from "@/services/variance-drivers";
import { BacklogTriage } from "@/ui/BacklogTriage";
import { CommittedActionsReview } from "@/ui/CommittedActionsReview";
import { LearningProposals } from "@/ui/LearningProposals";

function fmt(n: number) {
    if (n === null || n === undefined) return "-";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function fmtPct(pct: number) {
    if (pct === null || pct === undefined || isNaN(pct) || !isFinite(pct)) return "-";
    return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(pct / 100);
}

export default function ReviewPage() {
    return (
        <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading review...</div>}>
            <ReviewPageInner />
        </Suspense>
    );
}

function ReviewPageInner() {
    const searchParams = useSearchParams();
    const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
    const { isLoaded: isOrgLoaded, organization } = useOrganization();

    const legacyCompanyId = (!isSignedIn && (searchParams.get("companyId") ?? (typeof window !== "undefined" ? localStorage.getItem("cfdo_company_id") : null))) || null;
    const companyId = isSignedIn && organization ? organization.id : legacyCompanyId;

    const [data, setData] = useState<any>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showRoll, setShowRoll] = useState(false);
    const [viewHistorical, setViewHistorical] = useState<string | null>(null);
    const [driverData, setDriverData] = useState<VarianceDriverResult | null>(null);
    const [driverLoading, setDriverLoading] = useState(false); // null means Active

    const loadData = () => {
        if (!companyId) return;
        setLoading(true);
        fetch('/api/review', { headers: { 'Accept': 'application/json' } })
            .then(r => r.json())
            .then(d => {
                if (d.error) setError(d.error);
                else {
                    setData(d);
                    setError(null);
                }
            })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    };

    useEffect(() => {
        if ((isAuthLoaded && isOrgLoaded) || legacyCompanyId) {
            loadData();
        }
    }, [isAuthLoaded, isOrgLoaded, companyId, legacyCompanyId]);

    const handleRollComplete = async () => {
        setShowRoll(false);
        loadData();
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading review...</div>;
    if (error) return <div className="p-8 text-red-500">Error: {error}</div>;
    if (!data) return null;

    const historicalOptions = data.historical.map((h: any) => h.weekStart);

    const activeData = viewHistorical ? data.historical.find((h: any) => h.weekStart === viewHistorical) : data.active;

    useEffect(() => {
        if (isHistorical && activeData?.checkpoint?.id) {
            setDriverLoading(true);
            fetch(`/api/variance-drivers?checkpointId=${activeData.checkpoint.id}`)
                .then(r => r.json())
                .then(d => setDriverData(d.error ? null : d))
                .catch(() => setDriverData(null))
                .finally(() => setDriverLoading(false));
        } else {
            setDriverData(null);
        }
    }, [viewHistorical, activeData?.checkpoint?.id]);

    // Determine adaptive columns
    const hasOriginal = !!activeData.originalPlan;
    const hasRevised = !!activeData.revisedPlan;
    const isHistorical = !!viewHistorical;

    let columns = [];
    if (!hasOriginal) {
        columns = ["Latest Forecast", "Actual"];
    } else if (!hasRevised) {
        columns = ["Approved Plan", "Latest Forecast", "Actual"];
    } else {
        columns = ["Original Plan", "Revised Plan", "Latest Forecast", "Actual"];
    }

    const extractBreakdown = (sourceData: any, type: string) => {
        if (!sourceData) return null;
        if (typeof sourceData === "string") {
            try {
                const parsed = JSON.parse(sourceData);
                return parsed.weeks?.[0]?.breakdown || parsed.breakdownJson || parsed;
            } catch { return null; }
        }
        if (sourceData.breakdownJson) {
            try { return JSON.parse(sourceData.breakdownJson); } catch { return null; }
        }
        return sourceData.breakdown || sourceData.weeks?.[0]?.breakdown || null;
    };

    const getMetric = (planStr: any, field: string) => {
        if (field === "reconciliationDifference") return 0;
        if (!planStr) return null;
        let p;
        try { p = typeof planStr === "string" ? JSON.parse(planStr) : planStr; } catch { return null; }
        const w = p.weeks?.[0] || p;
        return w[field];
    };

    const getOriginalMetric = (field: string) => getMetric(activeData.originalPlan?.forecastStateJson, field);
    const getRevisedMetric = (field: string) => getMetric(activeData.revisedPlan?.forecastStateJson, field);
    const getForecastMetric = (field: string) => {
        if (field === "reconciliationDifference") return 0;
        if (isHistorical) return getMetric(activeData.checkpoint, field);
        return getMetric(activeData.latestForecast, field);
    };

    const getActualMetric = (field: string) => {
        if (!isHistorical) return null;
        if (activeData.actuals) {
            return activeData.actuals[field] ?? null;
        }
        if (isHistorical && activeData.revisedPlan?.actualEndingCash) {
            if (field === "endCashExpected") return activeData.revisedPlan.actualEndingCash;
        }
        if (isHistorical && activeData.originalPlan?.actualEndingCash) {
            if (field === "endCashExpected") return activeData.originalPlan.actualEndingCash;
        }
        return null;
    };

    return (
        <div className="min-h-screen bg-slate-50/50 pb-20">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
                <div className="max-w-5xl mx-auto px-5 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        <h1 className="font-bold text-slate-900 text-lg tracking-tight">Weekly Review</h1>
                        <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                            Week {new Date(activeData.weekStart).toLocaleDateString()}
                        </span>
                    </div>

                    <div className="flex items-center gap-4">
                        <select
                            className="text-sm border-slate-200 rounded-lg shadow-sm"
                            value={viewHistorical || ""}
                            onChange={e => setViewHistorical(e.target.value || null)}
                        >
                            <option value="">Active Review (Current Week)</option>
                            {historicalOptions.map((w: string) => (
                                <option key={w} value={w}>Historical: {new Date(w).toLocaleDateString()}</option>
                            ))}
                        </select>
                        {!isHistorical && (
                            <button
                                onClick={() => setShowRoll(true)}
                                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-2"
                            >
                                Close Week & Roll
                                <ArrowRight className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-5 py-8 space-y-8">
                {/* Comparison Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                        <h3 className="font-bold text-slate-800 text-sm">Forecast Comparison</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead>
                                <tr>
                                    <th className="px-6 py-3 font-semibold text-slate-500 border-b">Metric</th>
                                    {columns.map(c => (
                                        <th key={c} className="px-6 py-3 font-semibold text-slate-500 text-right border-b">{c}</th>
                                    ))}
                                    <th className="px-6 py-3 font-semibold text-slate-500 text-right border-b">Variance ($)</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {[
                                    { label: "Beginning Cash", field: "startCash" },
                                    { label: "Total Inflows", field: "inflowsExpected" },
                                    { label: "Total Outflows", field: "outflowsExpected" },
                                    { label: "Reconciliation Difference", field: "reconciliationDifference", help: "Difference between the reported bank balance and the balance implied by imported bank transactions for this week." },
                                    { label: "Expected Ending Cash", field: "endCashExpected" }
                                ].map(row => {
                                    const orig = getOriginalMetric(row.field);
                                    const rev = getRevisedMetric(row.field);
                                    const latest = getForecastMetric(row.field);
                                    const act = getActualMetric(row.field);

                                    // Variance: Actual vs Latest Forecast (or Revised vs Forecast if active)
                                    const compareBase = hasRevised ? rev : (hasOriginal ? orig : latest);
                                    const compareTarget = isHistorical ? (act ?? latest) : latest;
                                    const variance = compareTarget !== null && compareBase !== null ? compareTarget - compareBase : null;

                                    return (
                                        <tr key={row.label} className="bg-white hover:bg-slate-50 transition-colors">
                                            <td className="px-6 py-3 font-medium text-slate-700">
                                                <div className="flex items-center gap-1.5">
                                                    {row.label}
                                                    {row.help && <HelpBubble text={row.help} />}
                                                </div>
                                            </td>
                                            {hasOriginal && hasRevised && <td className="px-6 py-3 text-right font-financial text-slate-500">{fmt(orig)}</td>}
                                            {hasOriginal && <td className="px-6 py-3 text-right font-financial text-slate-500">{fmt(hasRevised ? rev : orig)}</td>}
                                            <td className="px-6 py-3 text-right font-financial font-medium text-slate-900">{fmt(latest)}</td>
                                            <td className="px-6 py-3 text-right font-financial text-slate-700">
                                                {act !== null ? fmt(act) : <span className="text-slate-400 italic text-xs">Unverified</span>}
                                            </td>
                                            <td className={`px-6 py-3 text-right font-financial font-medium ${(variance ?? 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                                {variance !== null ? (variance > 0 ? "+" : "") + fmt(variance) : "-"}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Variance Drivers */}
                {isHistorical && driverData && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-8">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                            <h3 className="font-bold text-slate-800 text-sm">Variance Drivers</h3>
                        </div>
                        <div className="p-6">
                            <VarianceDriverPanel data={driverData} />
                        </div>
                    </div>
                )}

                {/* Learning Proposals */}
                {!isHistorical && data?.learningProposals && data.learningProposals.length > 0 && (
                    <LearningProposals 
                        proposals={data.learningProposals} 
                        onAction={loadData} 
                    />
                )}

                {/* Committed Actions Review */}
                {((!isHistorical && data?.priorWeekActions && data.priorWeekActions.length > 0) || (isHistorical && activeData.actions && activeData.actions.length > 0)) && (
                    <CommittedActionsReview
                        actions={isHistorical ? activeData.actions : data.priorWeekActions}
                        customerObservations={data.customerObservations || []}
                        vendorObservations={data.vendorObservations || []}
                        readOnly={isHistorical}
                    />
                )}

                {/* Post-Approval Changes */}
                {!isHistorical && activeData.changes && activeData.changes.length > 0 && (
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                            <h3 className="font-bold text-slate-800 text-sm">Post-Approval Drift</h3>
                        </div>
                        <ul className="divide-y divide-slate-100">
                            {activeData.changes.map((c: any) => (
                                <li key={c.id} className="px-6 py-3 flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-medium text-slate-800">{c.action}</p>
                                        <p className="text-xs text-slate-500">
                                            {c.source} — {new Date(c.timestamp).toLocaleString()}
                                        </p>
                                        {c.reason && (
                                            <p className="text-sm italic text-slate-600 mt-1">Reason: {c.reason}</p>
                                        )}
                                    </div>
                                    <div className="text-sm text-slate-600">
                                        {c.inputText}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Backlog Triage for Active Review */}
                {!isHistorical && data?.backlog && (
                    <div className="mt-8">
                        <BacklogTriage
                            companyId={companyId!}
                            backlog={data.backlog}
                            weeks={data?.active?.latestForecast ? [data.active.latestForecast] : []}
                            onScheduled={loadData}
                        />
                    </div>
                )}
            </main>

            {/* Roll Dialog Orchestration */}
            {showRoll && data?.active?.latestForecast && (
                <UpdateBalanceDialog
                    currentBalance={data.cash?.bankBalance || 0}
                    currentAdjustments={data.cash?.adjustments || []}
                    companyId={companyId!}
                    executionPlanId={data.active.revisedPlan?.id || data.active.originalPlan?.id}
                    priorWeekData={data.active.latestForecast}
                    lastUpdated={data.lastUpdated}
                    onSaved={handleRollComplete}
                    onCancel={() => setShowRoll(false)}
                />
            )}
        </div>
    );
}
