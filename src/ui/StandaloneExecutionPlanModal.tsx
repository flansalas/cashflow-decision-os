"use client";

import { useState, useEffect } from "react";
import { ExecutionPlanModal } from "./ExecutionPlanModal";

export function StandaloneExecutionPlanModal({ companyId, onClose }: { companyId: string, onClose: () => void }) {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`/api/cashflow-grid?companyId=${companyId}`)
            .then(res => res.json())
            .then(d => {
                setData(d);
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
            });
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

    if (!data) return null;

    return (
        <ExecutionPlanModal
            companyId={companyId}
            weeks={data.weeks}
            invoices={data.invoices}
            bills={data.bills}
            openingCash={data.openingCash}
            breakdown={data.forecast?.weeks?.[0]?.breakdown}
            onClose={onClose}
            executionPlan={data.executionPlan}
            forecastStateJson={data.forecast}
            onApprove={() => {
                window.location.reload();
            }}
        />
    );
}
