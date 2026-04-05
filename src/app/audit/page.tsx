"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { History, ArrowLeft, RefreshCw, Layers, AlertCircle, FileJson, RotateCcw } from "lucide-react";

interface ChangeLog {
    id: string;
    timestamp: string;
    source: string;
    action: string;
    inputText: string | null;
    diffJson: string;
}

function AuditLogContent() {
    const searchParams = useSearchParams();
    const companyId = searchParams.get("companyId") ?? (typeof window !== "undefined" ? localStorage.getItem("cfdo_company_id") : null);

    const [logs, setLogs] = useState<ChangeLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [undoingId, setUndoingId] = useState<string | null>(null);

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/audit${companyId ? `?companyId=${companyId}` : ""}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to load");
            setLogs(data);
            setError(null);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleUndo = async (changeLogId: string) => {
        if (!confirm("Are you sure you want to revert this action?")) return;
        setUndoingId(changeLogId);
        try {
            const res = await fetch(`/api/audit/undo`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ changeLogId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to undo");
            await fetchData();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setUndoingId(null);
        }
    };

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId]);

    const formatAction = (action: string) => {
        if (!action) return 'Unknown Action';
        return action.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    };

    const parseDiff = (json: string) => {
        if (!json) return null;
        try {
            const parsed = JSON.parse(json);
            return parsed;
        } catch {
            return json;
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center p-6 bg-[var(--bg-base)]">
                <div className="animate-spin w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[var(--bg-base)] gap-4">
                <div className="flex items-center gap-2 text-red-600 bg-red-50 p-4 rounded-xl border border-red-100">
                    <AlertCircle className="w-5 h-5"/>
                    <span className="font-medium">{error}</span>
                </div>
                <button
                    onClick={fetchData}
                    className="px-4 py-2 bg-white border rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors shadow-sm"
                >
                    Try Again
                </button>
            </div>
        );
    }

    return (
        <div className="min-h-screen pb-12" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
            <header className="border-b sticky top-0 z-50 backdrop-blur-md" style={{ background: "rgba(255,255,255,0.92)", borderColor: "var(--border-subtle)" }}>
                <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <a href="/dashboard" className="text-sm font-medium flex items-center gap-1.5 px-2 py-1 -ml-2 rounded-md hover:bg-slate-100 transition-colors" style={{ color: "var(--text-secondary)" }}>
                            <ArrowLeft className="w-4 h-4" /> Dashboard
                        </a>
                        <div className="h-4 w-px bg-slate-300" />
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-md" style={{ background: "var(--bg-raised)", color: "var(--color-primary)" }}>
                                <History className="w-4 h-4" />
                            </div>
                            <span className="font-semibold text-lg tracking-tight">Audit Log</span>
                        </div>
                    </div>
                    <button
                        onClick={fetchData}
                        className="p-2 rounded-lg border text-sm hover:bg-slate-50 transition-colors flex items-center gap-2 shadow-sm"
                        style={{ background: "white", borderColor: "var(--border-default)" }}
                    >
                        <RefreshCw className="w-4 h-4 text-slate-500" />
                        <span className="font-medium text-slate-700 hidden sm:inline">Refresh</span>
                    </button>
                </div>
            </header>
            
            <main className="max-w-5xl mx-auto px-6 py-8">
                 <div className="mb-8">
                     <h1 className="text-2xl font-bold mb-2">History & Activity</h1>
                     <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                         Review all structural changes, system updates, and user modifications over time.
                     </p>
                 </div>

                 <div className="space-y-6">
                     {logs.length === 0 ? (
                         <div className="flex flex-col items-center justify-center py-16 px-4 border rounded-2xl bg-white shadow-sm border-dashed" style={{ borderColor: "var(--border-default)" }}>
                             <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                                 <History className="w-6 h-6 text-slate-400" />
                             </div>
                             <h3 className="text-lg font-medium mb-1">No Activity Found</h3>
                             <p className="text-sm text-center max-w-sm" style={{ color: "var(--text-muted)" }}>
                                 No changes have been recorded for this company yet. Modifying forecasts or syncing data will appear here.
                             </p>
                         </div>
                     ) : (
                         logs.map((log, index) => {
                             const diffData = parseDiff(log.diffJson);
                             const isSystem = log.source === 'system';
                             const isUndoable = log.action === 'FORECAST_OVERRIDE' || log.action === 'REMOVE_OVERRIDE';
                             
                             return (
                                 <div key={log.id} className="relative pl-8">
                                     {index !== logs.length - 1 && (
                                         <div className="absolute left-[11px] top-8 bottom-[-24px] w-0.5 bg-slate-100" />
                                     )}
                                     
                                     <div className={`absolute left-0 top-1.5 w-[24px] h-[24px] rounded-full border-2 border-white flex items-center justify-center z-10 ${isSystem ? 'bg-indigo-100' : 'bg-emerald-100'}`}>
                                         {isSystem ? <Layers className="w-3 h-3 text-indigo-600" /> : <History className="w-3 h-3 text-emerald-600" />}
                                     </div>

                                     <div className="border rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
                                         <div className="p-5">
                                             <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
                                                 <div className="flex items-center gap-3">
                                                     <div className="text-base font-semibold tracking-tight text-slate-900">
                                                         {formatAction(log.action)}
                                                     </div>
                                                     <span className={`px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider ${
                                                         isSystem 
                                                             ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' 
                                                             : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                                     }`}>
                                                         {isSystem ? 'Auto-Sync' : (log.source === 'user_ui' ? 'User Edit' : (log.source || 'User Action'))}
                                                     </span>
                                                 </div>
                                                 <div className="flex items-center gap-3">
                                                     <div className="text-xs font-medium text-slate-500 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                                                         {new Date(log.timestamp).toLocaleString(undefined, {
                                                             month: 'short', day: 'numeric', year: 'numeric',
                                                             hour: 'numeric', minute: '2-digit'
                                                         })}
                                                     </div>
                                                     {isUndoable && (
                                                         <button 
                                                             onClick={() => handleUndo(log.id)}
                                                             disabled={undoingId === log.id}
                                                             className="px-2 py-1 flex items-center gap-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 text-red-600 hover:bg-red-50 hover:border-red-200 border border-transparent"
                                                         >
                                                             <RotateCcw className="w-3.5 h-3.5" />
                                                             {undoingId === log.id ? 'Undoing...' : 'Undo'}
                                                         </button>
                                                     )}
                                                 </div>
                                             </div>

                                             {log.inputText && (
                                                 <div className="mb-4">
                                                     <div className="text-[13px] border-l-[3px] pl-3 py-1 font-medium" style={{ borderColor: "var(--color-primary)", color: "var(--text-secondary)" }}>
                                                         {log.inputText}
                                                     </div>
                                                 </div>
                                             )}

                                             {diffData && typeof diffData === 'object' && (
                                                 <div className="mt-4 pt-4 border-t border-slate-100">
                                                     <div className="flex items-center gap-1.5 mb-3 px-1">
                                                         <Layers className="w-3.5 h-3.5 text-slate-400" />
                                                         <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Adjustment Details</span>
                                                     </div>
                                                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                         {Object.entries(diffData).map(([key, val]) => {
                                                             if (key === 'targetId' || val === null || val === undefined) return null;
                                                             
                                                             let displayVal = String(val);
                                                             if (typeof val === 'number') {
                                                                 if (key.toLowerCase().includes('balance') || key.toLowerCase().includes('amount')) {
                                                                     displayVal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(val);
                                                                 } else {
                                                                     displayVal = val.toLocaleString();
                                                                 }
                                                             } else if (typeof val === 'string' && val.includes('T00:00:00')) {
                                                                 // crude date check
                                                                 try { displayVal = new Date(val).toLocaleDateString(); } catch {}
                                                             }
                                                             
                                                             const displayKey = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();

                                                             return (
                                                                 <div key={key} className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex flex-col justify-center">
                                                                     <span className="block text-[10px] uppercase text-slate-400 font-bold tracking-wider mb-1 capitalize">{displayKey}</span>
                                                                     <span className="text-sm font-semibold text-slate-800 capitalize">{displayVal.replace(/_/g, ' ')}</span>
                                                                 </div>
                                                             );
                                                         })}
                                                     </div>
                                                 </div>
                                             )}
                                         </div>
                                     </div>
                                 </div>
                             );
                         })
                     )}
                 </div>
            </main>
        </div>
    );
}

export default function AuditPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-[var(--bg-base)]">
                <div className="animate-pulse flex items-center gap-2">
                    <History className="w-5 h-5 text-slate-400" />
                    <span className="text-slate-500 font-medium">Loading Audit Environment...</span>
                </div>
            </div>
        }>
            <AuditLogContent />
        </Suspense>
    );
}
