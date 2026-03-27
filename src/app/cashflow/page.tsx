// app/cashflow/page.tsx — AR/AP Weekly Cash Grid page
"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { CashflowGrid } from "@/ui/CashflowGrid";
import { ARAPUploadStep } from "@/ui/ARAPUploadStep";
import { BankUploadStep } from "@/ui/BankUploadStep";
import { ArrowLeft, Upload, Landmark, RefreshCw, X, AlertTriangle, Box } from "lucide-react";
import type { GridItem } from "@/ui/ARAPCard";

interface WeekMeta {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
}

interface RecurringWeek {
    weekNumber: number;
    total: number;
}

interface GridData {
    companyId: string;
    openingCash: number;
    weeks: WeekMeta[];
    invoices: Array<{
        id: string;
        customerName: string;
        invoiceNo: string;
        amountOpen: number;
        originalAmount: number;
        invoiceDate: string | null;
        dueDate: string | null;
        daysPastDue: number | null;
        expectedDate: string;
        effectiveWeek: number | null;
        overrideDate: string | null;
        riskTag: string;
        confidence: string;
        moveCount: number;
        kind: "ar";
    }>;
    bills: Array<{
        id: string;
        vendorName: string;
        billNo: string;
        amountOpen: number;
        originalAmount: number;
        billDate: string | null;
        dueDate: string | null;
        daysPastDue: number | null;
        effectiveDate: string;
        effectiveWeek: number | null;
        overrideDate: string | null;
        criticality: string;
        moveCount: number;
        kind: "ap";
    }>;
    weeklyRecurringOutflows: RecurringWeek[];
    weeklyRecurringInflows: RecurringWeek[];
}

function CashflowContent() {
    const searchParams = useSearchParams();
    const urlCompanyId = searchParams.get("companyId");
    const highlightWeek = searchParams.get("highlightWeek") ? Number(searchParams.get("highlightWeek")) : null;
    const highlightId = searchParams.get("highlightId");
    const mode = searchParams.get("mode") as "ar" | "ap" | null;

    const [data, setData] = useState<GridData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showUpload, setShowUpload] = useState(false);
    const [showBankUpload, setShowBankUpload] = useState(false);
    const [viewFilter, setViewFilter] = useState<"both" | "ar" | "ap">(mode ?? "both");

    useEffect(() => {
        if (mode) setViewFilter(mode);
    }, [mode]);

    const companyId = urlCompanyId ?? (typeof window !== "undefined" ? localStorage.getItem("cfdo_company_id") : null);

    const fetchGrid = useCallback(() => {
        const url = companyId ? `/api/cashflow-grid?companyId=${companyId}` : "/api/cashflow-grid";
        setLoading(true);
        fetch(url)
            .then(r => r.json())
            .then(d => {
                if (d.error) { setError(d.error); }
                else { setData(d); setError(null); }
            })
            .catch(() => setError("Failed to load"))
            .finally(() => setLoading(false));
    }, [companyId]);

    useEffect(() => { fetchGrid(); }, [fetchGrid]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="text-center space-y-4">
                    <div className="animate-spin w-10 h-10 border-[3px] border-blue-500 border-t-transparent rounded-full mx-auto" />
                    <p className="text-sm tracking-wide" style={{ color: "var(--text-muted)" }}>Loading cash grid…</p>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="border rounded-xl p-8 max-w-md text-center" style={{ background: '#fff5f5', borderColor: 'rgba(220,38,38,0.25)' }}>
                    <p style={{ color: '#dc2626' }} className="text-base font-medium mb-3 flex items-center justify-center gap-2">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" /> {error}
                    </p>
                    <a href="/dashboard" style={{ color: 'var(--color-primary)' }} className="hover:underline text-sm flex items-center justify-center gap-1">
                        <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
                    </a>
                </div>
            </div>
        );
    }

    // Transform API data into GridItem[]
    const invoiceItems: GridItem[] = data.invoices.map(inv => ({
        id: inv.id,
        kind: "ar" as const,
        label: `${inv.customerName} (${inv.invoiceNo})`,
        amountOpen: inv.amountOpen,
        originalAmount: inv.originalAmount,
        effectiveWeek: inv.effectiveWeek,
        overrideDate: inv.overrideDate,
        risk: inv.riskTag,
        confidence: inv.confidence,
        // Detail drawer fields
        customerName: inv.customerName,
        invoiceNo: inv.invoiceNo,
        invoiceDate: inv.invoiceDate,
        dueDate: inv.dueDate,
        daysPastDue: inv.daysPastDue,
        expectedDate: inv.expectedDate,
        moveCount: inv.moveCount,
    }));

    const billItems: GridItem[] = data.bills.map(bill => ({
        id: bill.id,
        kind: "ap" as const,
        label: `${bill.vendorName} (${bill.billNo})`,
        amountOpen: bill.amountOpen,
        originalAmount: bill.originalAmount,
        effectiveWeek: bill.effectiveWeek,
        overrideDate: bill.overrideDate,
        risk: bill.criticality,
        // Detail drawer fields
        vendorName: bill.vendorName,
        billNo: bill.billNo,
        billDate: bill.billDate,
        dueDate: bill.dueDate,
        daysPastDue: bill.daysPastDue,
        effectiveDate: bill.effectiveDate,
        moveCount: bill.moveCount,
    }));

    return (
        <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
            {/* Header */}
            <header className="border-b sticky top-0 z-50 backdrop-blur-md" style={{ background: "rgba(255,255,255,0.92)", borderColor: "var(--border-subtle)", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div className="max-w-[100rem] mx-auto px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <a href="/dashboard" className="text-xs font-medium flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                            <ArrowLeft className="w-3 h-3" /> Dashboard
                        </a>
                        <span style={{ color: "var(--border-default)" }}>/</span>
                        <span style={{ color: "var(--color-primary)" }} className="font-bold text-sm flex items-center gap-1"><Box className="w-4 h-4" /> AR/AP Ledger</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* View filter */}
                        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--border-default)" }}>
                            <button
                                onClick={() => setViewFilter("both")}
                                className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${viewFilter === "both"
                                        ? "text-white"
                                        : "hover:text-white"
                                    }`}
                                style={viewFilter === "both" ? { background: "var(--color-primary)", color: "#fff" } : { background: "var(--bg-raised)", color: "var(--text-muted)" }}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setViewFilter("ar")}
                                className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide border-l"
                                style={viewFilter === "ar"
                                    ? { background: "rgba(5,150,105,0.10)", color: "#059669", borderColor: "var(--border-default)" }
                                    : { background: "var(--bg-raised)", color: "var(--text-muted)", borderColor: "var(--border-default)" }}
                            >
                                AR
                            </button>
                            <button
                                onClick={() => setViewFilter("ap")}
                                className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide border-l"
                                style={viewFilter === "ap"
                                    ? { background: "rgba(99,102,241,0.10)", color: "#4f46e5", borderColor: "var(--border-default)" }
                                    : { background: "var(--bg-raised)", color: "var(--text-muted)", borderColor: "var(--border-default)" }}
                            >
                                AP
                            </button>
                        </div>
                        <button
                            onClick={() => setShowUpload(true)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg border flex items-center gap-1.5"
                            style={{ background: "var(--color-primary-glow)", borderColor: "rgba(59,130,246,0.30)", color: "var(--color-primary)" }}
                        >
                            <Upload className="w-3.5 h-3.5" /> Upload Report
                        </button>
                        <button
                            onClick={() => setShowBankUpload(true)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg border flex items-center gap-1.5"
                            style={{ background: "rgba(5,150,105,0.08)", borderColor: "rgba(5,150,105,0.25)", color: "#059669" }}
                        >
                            <Landmark className="w-3.5 h-3.5" /> Upload Bank
                        </button>
                        <button
                            onClick={fetchGrid}
                            className="p-1.5 rounded-lg border text-sm"
                            title="Refresh grid"
                            style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-muted)" }}
                        >
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-[100rem] mx-auto px-4 py-6">
                <CashflowGrid
                    weeks={data.weeks}
                    invoices={viewFilter === "ap" ? [] : invoiceItems}
                    bills={viewFilter === "ar" ? [] : billItems}
                    openingCash={data.openingCash}
                    weeklyRecurringOutflows={data.weeklyRecurringOutflows}
                    weeklyRecurringInflows={data.weeklyRecurringInflows}
                    companyId={data.companyId}
                    highlightWeek={highlightWeek}
                    highlightId={highlightId}
                    onRefresh={fetchGrid}
                />
            </main>

            {/* Upload Modal */}
            {showUpload && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}>
                    <div className="border rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
                        <div className="px-6 py-4 border-b flex justify-between items-center sticky top-0" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Update AR/AP Reports</h2>
                            <button onClick={() => setShowUpload(false)} className="w-8 h-8 flex items-center justify-center rounded-lg border transition-colors" style={{ color: "var(--text-muted)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}><X className="w-4 h-4" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            <ARAPUploadStep companyId={data.companyId} onDone={() => { setShowUpload(false); fetchGrid(); }} />
                        </div>
                    </div>
                </div>
            )}

            {/* Bank Upload Modal */}
            {showBankUpload && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(8px)" }}>
                    <div className="border rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
                        <div className="px-6 py-4 border-b flex justify-between items-center sticky top-0" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Upload Bank Statement</h2>
                            <button onClick={() => setShowBankUpload(false)} className="w-8 h-8 flex items-center justify-center rounded-lg border transition-colors" style={{ color: "var(--text-muted)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}><X className="w-4 h-4" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto">
                            <BankUploadStep companyId={data.companyId} onDone={() => { setShowBankUpload(false); fetchGrid(); }} />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function CashflowPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="animate-spin w-10 h-10 border-[3px] border-blue-500 border-t-transparent rounded-full" />
            </div>
        }>
            <CashflowContent />
        </Suspense>
    );
}
