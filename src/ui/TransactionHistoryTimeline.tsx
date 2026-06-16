"use client";

import { useState, useEffect } from "react";
import { User, Server, FileText, ArrowRight, ShieldCheck, History } from "lucide-react";

export interface AuditEvent {
    id: string;
    action: string;
    source: "user" | "system" | "bank_sync" | "bookkeeper";
    timestamp: string;
    fieldChanged: string;
    oldValue: string | number | null;
    newValue: string | number | null;
    reasoning: string | null;
}

function SourceIcon({ source }: { source: AuditEvent["source"] }) {
    switch (source) {
        case "user":
            return <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center border border-emerald-200"><User className="w-3.5 h-3.5 text-emerald-600" /></div>;
        case "system":
            return <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center border border-indigo-200"><Server className="w-3.5 h-3.5 text-indigo-600" /></div>;
        case "bank_sync":
            return <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center border border-blue-200"><ShieldCheck className="w-3.5 h-3.5 text-blue-600" /></div>;
        case "bookkeeper":
            return <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center border border-orange-200"><FileText className="w-3.5 h-3.5 text-orange-600" /></div>;
        default:
            return <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200"><History className="w-3.5 h-3.5 text-slate-600" /></div>;
    }
}

function SourceLabel({ source }: { source: AuditEvent["source"] }) {
    switch (source) {
        case "user": return <span className="font-semibold text-emerald-700">You</span>;
        case "system": return <span className="font-semibold text-indigo-700">System</span>;
        case "bank_sync": return <span className="font-semibold text-blue-700">Bank Sync</span>;
        case "bookkeeper": return <span className="font-semibold text-orange-700">Bookkeeper</span>;
        default: return <span className="font-semibold text-slate-700">Unknown</span>;
    }
}

function formatValue(key: string, val: string | number | null): string {
    if (val === null) return "None";
    if (typeof val === "number") {
        if (key.toLowerCase().includes("amount") || key.toLowerCase().includes("balance")) {
            return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(val);
        }
        return val.toLocaleString();
    }
    // Attempt date format if looks like ISO
    if (typeof val === "string" && val.match(/^\d{4}-\d{2}-\d{2}/)) {
        try {
            return new Date(val).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
        } catch { /* ignore */ }
    }
    return val;
}

export function TransactionHistoryTimeline({ targetId }: { targetId: string }) {
    const [events, setEvents] = useState<AuditEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchEvents() {
            try {
                const res = await fetch(`/api/audit?targetId=${targetId}`);
                if (res.ok) {
                    const data = await res.json();
                    setEvents(data.events || []);
                }
            } catch (err) {
                console.error("Failed to fetch audit events", err);
            } finally {
                setLoading(false);
            }
        }
        fetchEvents();
    }, [targetId]);

    if (loading) {
        return <div className="text-center py-4 text-xs text-slate-500">Loading history...</div>;
    }

    if (events.length === 0) {
        return <div className="text-center py-6 text-xs text-slate-500">No history available for this item yet.</div>;
    }

    return (
        <div className="relative pt-2 pb-6">
            <div className="absolute left-3 top-4 bottom-8 w-px bg-slate-200" />
            
            <div className="space-y-6">
                {events.map((evt) => (
                    <div key={evt.id} className="relative pl-10 pr-2">
                        {/* Timeline node */}
                        <div className="absolute left-0 top-0">
                            <SourceIcon source={evt.source} />
                        </div>

                        {/* Content */}
                        <div>
                            <div className="flex items-baseline justify-between mb-0.5 gap-2">
                                <div className="text-sm font-semibold text-slate-900 leading-tight">
                                    {evt.action}
                                </div>
                                <div className="text-[10px] font-medium text-slate-500 whitespace-nowrap">
                                    {new Date(evt.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                </div>
                            </div>
                            
                            <div className="text-xs mb-2" style={{ color: "var(--text-secondary)" }}>
                                By <SourceLabel source={evt.source} />
                            </div>

                            {/* QBO Style Diff Panel */}
                            <div className="bg-slate-50 rounded-md border border-slate-200 p-2.5 mb-1.5 shadow-sm">
                                <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mb-1.5">
                                    {evt.fieldChanged.replace(/([A-Z])/g, ' $1').trim()}
                                </div>
                                <div className="flex items-center gap-2 text-sm flex-wrap">
                                    {evt.oldValue !== null && (
                                        <span className="line-through text-slate-400 font-medium bg-slate-100 px-1.5 py-0.5 rounded">
                                            {formatValue(evt.fieldChanged, evt.oldValue)}
                                        </span>
                                    )}
                                    {evt.oldValue !== null && <ArrowRight className="w-3.5 h-3.5 text-slate-300" />}
                                    <span className="font-bold text-slate-800 bg-amber-100/50 px-1.5 py-0.5 rounded">
                                        {formatValue(evt.fieldChanged, evt.newValue)}
                                    </span>
                                </div>
                            </div>

                            {/* Reasoning */}
                            {evt.reasoning && (
                                <div className="text-[11px] italic text-slate-500 flex items-center gap-1.5 mt-2 bg-white inline-flex px-2 py-1 rounded border border-slate-100">
                                    <span>“{evt.reasoning}”</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
