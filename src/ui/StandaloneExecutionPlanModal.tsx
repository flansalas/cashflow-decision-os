"use client";

import { Component, type ErrorInfo, type ReactNode, useState, useEffect } from "react";
import { ExecutionPlanModal } from "./ExecutionPlanModal";

function ModalFailure({ message, onClose }: { message: string; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
                <h2 className="text-lg font-bold text-rose-700">Execution Plan Unavailable</h2>
                <p className="mt-2 text-sm text-slate-600">{message}</p>
                <button
                    onClick={onClose}
                    className="mt-5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100"
                >
                    Close
                </button>
            </div>
        </div>
    );
}

class ExecutionPlanBoundary extends Component<
    { children: ReactNode; onClose: () => void },
    { failed: boolean }
> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("Execution Plan render error:", error, info);
    }

    render() {
        if (this.state.failed) {
            return (
                <ModalFailure
                    message="The plan could not be displayed. Close this window and retry after refreshing the page."
                    onClose={this.props.onClose}
                />
            );
        }
        return this.props.children;
    }
}

export function StandaloneExecutionPlanModal({ companyId, onClose, initialMode = 'select' }: { companyId: string, onClose: () => void, initialMode?: 'select' | 'approved' | 'live' }) {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError(null);

        fetch(`/api/cashflow-grid?companyId=${companyId}`)
            .then(async res => {
                const body = await res.json().catch(() => null);
                if (!res.ok) {
                    throw new Error(body?.error || `Unable to load the execution plan (${res.status})`);
                }
                if (!Array.isArray(body?.weeks) || body.weeks.length !== 13 || !Array.isArray(body?.invoices) || !Array.isArray(body?.bills)) {
                    throw new Error("The execution plan response is incomplete.");
                }
                return body;
            })
            .then(d => {
                if (cancelled) return;
                setData(d);
                setLoading(false);
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setLoadError(error instanceof Error ? error.message : "Unable to load the execution plan.");
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [companyId]);

    if (loading) {
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}>
                <div className="bg-white rounded-2xl p-8 flex flex-col items-center gap-4">
                    <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm font-medium text-slate-500">Loading Execution Plan...</p>
                </div>
            </div>
        );
    }

    if (loadError) {
        return <ModalFailure message={loadError} onClose={onClose} />;
    }

    if (!data) {
        return <ModalFailure message="The execution plan returned no data." onClose={onClose} />;
    }

    return (
        <ExecutionPlanBoundary onClose={onClose}>
            <ExecutionPlanModal
                companyId={companyId}
                weeks={data.weeks}
                invoices={data.invoices}
                bills={data.bills}
                openingCash={data.openingCash}
                breakdown={data.forecast?.weeks?.[0]?.breakdown}
                onClose={onClose}
                executionPlan={data.executionPlan}
                initialMode={initialMode}
                forecastStateJson={data.forecast}
                onApprove={() => {
                    window.location.reload();
                }}
            />
        </ExecutionPlanBoundary>
    );
}
