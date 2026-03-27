// ui/BacklogTriage.tsx
// The "Week 0" backlog triage — surfaces past-due AR/AP that have fallen off the forecast horizon.
// Key design principles:
//  - AP (Bills owed): High urgency. Must be scheduled or explicitly deferred.
//  - AR (Invoices): Medium urgency. User decides which weeks to "count on" them in.
//  - All scheduling uses the existing Override mechanism — zero schema changes.
//  - Dismissal for AR = mark_paid override (removes from forecast cleanly).
//  - Deferral for AP = push to a far future week via set_bill_due_date.
"use client";

import { useState } from "react";
import { Calendar, CheckCircle, ClipboardList, X, ArrowUpRight, ArrowDownRight, ArrowRight, CheckCircle2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BacklogBill {
    id: string;
    vendorName: string;
    billNo: string;
    amountOpen: number;
    dueDate: string | null;
    daysPastDue: number | null;
    kind: "ap";
}

export interface BacklogInvoice {
    id: string;
    customerName: string;
    invoiceNo: string;
    amountOpen: number;
    dueDate: string | null;
    daysPastDue: number | null;
    kind: "ar";
}

export interface BacklogData {
    overdueAP: BacklogBill[];
    overdueAR: BacklogInvoice[];
    totalOverdueAP: number;
    totalOverdueAR: number;
}

interface WeekOption {
    weekNumber: number;
    weekEnd: string;
    weekStart: string;
}

interface Props {
    backlog: BacklogData;
    weeks: WeekOption[];
    companyId: string;
    onScheduled: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(iso: string | null): string {
    if (!iso) return "Unknown";
    const d = new Date(iso);
    return (d.getMonth() + 1) + "/" + d.getDate() + "/" + d.getFullYear().toString().slice(-2);
}

function formatWeekLabel(weekEnd: string): string {
    const d = new Date(weekEnd);
    return (d.getMonth() + 1) + "/" + d.getDate();
}

// ─── Week Picker ──────────────────────────────────────────────────────────────

function WeekPicker({
    weeks,
    onPick,
    onCancel,
    saving,
}: {
    weeks: WeekOption[];
    onPick: (weekStart: string) => void;
    onCancel: () => void;
    saving: boolean;
}) {
    return (
        <div className="mt-2 ml-1 rounded-lg p-3 border" style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)" }}>
            <p className="text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5" style={{ color: "var(--color-primary)" }}>
                <Calendar className="w-3.5 h-3.5" /> Schedule into week
            </p>
            <div className="flex flex-wrap gap-1.5 mb-2">
                {weeks.map(w => (
                    <button
                        key={w.weekNumber}
                        disabled={saving}
                        onClick={() => onPick(w.weekStart)}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium border disabled:opacity-40 hover:border-indigo-400 hover:text-indigo-600 transition-colors"
                        style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
                    >
                        W{w.weekNumber} · {formatWeekLabel(w.weekEnd)}
                    </button>
                ))}
            </div>
            <button
                onClick={onCancel}
                className="text-xs hover:text-indigo-600 transition-colors"
                style={{ color: "var(--text-muted)" }}
            >
                Cancel
            </button>
        </div>
    );
}

// ─── AP Row ───────────────────────────────────────────────────────────────────

function APRow({
    bill,
    weeks,
    companyId,
    onScheduled,
}: {
    bill: BacklogBill;
    weeks: WeekOption[];
    companyId: string;
    onScheduled: () => void;
}) {
    const [showPicker, setShowPicker] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const schedule = async (weekStart: string) => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/overrides", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    type: "set_bill_due_date",
                    targetType: "bill",
                    targetId: bill.id,
                    effectiveDate: weekStart,
                }),
            });
            if (!res.ok) { setError("Failed to save"); setSaving(false); return; }
            setDone(true);
            onScheduled();
        } catch {
            setError("Network error");
            setSaving(false);
        }
    };

    if (done) {
        return (
            <div className="flex items-center gap-2 py-2 px-3 rounded-lg border" style={{ background: "rgba(34,197,94,0.05)", borderColor: "rgba(34,197,94,0.15)" }}>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-sm line-through" style={{ color: "var(--text-muted)" }}>{bill.vendorName}</span>
                <span className="text-xs text-emerald-700 ml-auto">Scheduled</span>
            </div>
        );
    }

    const isUrgent = (bill.daysPastDue ?? 0) >= 30;

    return (
        <div>
            <div
                className={`flex items-center justify-between py-2.5 px-3 rounded-lg border gap-3 ${isUrgent ? "p1-pulse" : ""}`}
                style={{
                    background: isUrgent ? "rgba(220,38,38,0.05)" : "var(--bg-surface)",
                    borderColor: isUrgent ? "rgba(220,38,38,0.2)" : "var(--border-subtle)",
                }}
            >
                <div className="min-w-0">
                    <p className="text-sm truncate font-medium" style={{ color: "var(--text-primary)" }}>{bill.vendorName}</p>
                    <div className="flex gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{bill.billNo}</span>
                        <span className="text-xs" style={{ color: "var(--text-faint)" }}>·</span>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Due {formatDate(bill.dueDate)}</span>
                        {bill.daysPastDue != null && bill.daysPastDue > 0 && (
                            <>
                                <span className="text-xs" style={{ color: "var(--text-faint)" }}>·</span>
                                <span className="text-xs text-red-600 font-semibold">{bill.daysPastDue}d overdue</span>
                            </>
                        )}
                    </div>
                    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold font-financial text-red-600">{fmt(bill.amountOpen)}</span>
                    <button
                        onClick={() => setShowPicker(!showPicker)}
                        disabled={saving}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold border disabled:opacity-40 shadow-sm transition-colors"
                        style={{ background: "var(--bg-raised)", borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
                    >
                        Schedule <ArrowRight className="w-3 h-3 ml-1" />
                    </button>
                </div>
            </div>
            {showPicker && (
                <WeekPicker
                    weeks={weeks}
                    onPick={schedule}
                    onCancel={() => setShowPicker(false)}
                    saving={saving}
                />
            )}
        </div>
    );
}

// ─── AR Row ───────────────────────────────────────────────────────────────────

function ARRow({
    invoice,
    weeks,
    companyId,
    onScheduled,
}: {
    invoice: BacklogInvoice;
    weeks: WeekOption[];
    companyId: string;
    onScheduled: () => void;
}) {
    const [showPicker, setShowPicker] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<"scheduled" | "written-off" | null>(null);

    const scheduleAR = async (weekStart: string) => {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/overrides", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    type: "set_expected_payment_date",
                    targetType: "invoice",
                    targetId: invoice.id,
                    effectiveDate: weekStart,
                }),
            });
            if (!res.ok) { setError("Failed to save"); setSaving(false); return; }
            setDone("scheduled");
            onScheduled();
        } catch {
            setError("Network error");
            setSaving(false);
        }
    };

    const writeOff = async () => {
        if (!confirm(`Write off "${invoice.invoiceNo}" from ${invoice.customerName}? This removes it from the forecast. The original invoice is preserved.`)) return;
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/overrides", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    type: "mark_paid",
                    targetType: "invoice",
                    targetId: invoice.id,
                }),
            });
            if (!res.ok) { setError("Failed to save"); setSaving(false); return; }
            setDone("written-off");
            onScheduled();
        } catch {
            setError("Network error");
            setSaving(false);
        }
    };

    if (done) {
        return (
            <div className="flex items-center gap-2 py-2 px-3 rounded-lg border" style={{ background: "rgba(34,197,94,0.05)", borderColor: "rgba(34,197,94,0.15)" }}>
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span className="text-sm line-through" style={{ color: "var(--text-muted)" }}>{invoice.customerName}</span>
                <span className="text-xs text-emerald-700 ml-auto">
                    {done === "scheduled" ? "Scheduled" : "Written off"}
                </span>
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-center justify-between py-2.5 px-3 rounded-lg border gap-3"
                style={{ background: "rgba(34,197,94,0.03)", borderColor: "rgba(34,197,94,0.1)" }}
            >
                <div className="min-w-0">
                    <p className="text-sm truncate font-medium" style={{ color: "var(--text-primary)" }}>{invoice.customerName}</p>
                    <div className="flex gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>{invoice.invoiceNo}</span>
                        <span className="text-xs" style={{ color: "var(--text-faint)" }}>·</span>
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>Due {formatDate(invoice.dueDate)}</span>
                        {invoice.daysPastDue != null && invoice.daysPastDue > 0 && (
                            <>
                                <span className="text-xs" style={{ color: "var(--text-faint)" }}>·</span>
                                <span className="text-xs text-amber-600 font-semibold">{invoice.daysPastDue}d overdue</span>
                            </>
                        )}
                    </div>
                    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold font-financial text-emerald-700">{fmt(invoice.amountOpen)}</span>
                    <button
                        onClick={() => setShowPicker(!showPicker)}
                        disabled={saving}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold border disabled:opacity-40 shadow-sm transition-colors"
                        style={{ background: "var(--bg-raised)", borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
                    >
                        Expect in <ArrowRight className="w-3 h-3 ml-1" />
                    </button>
                    <button
                        onClick={writeOff}
                        disabled={saving}
                        title="Remove from forecast (write off / uncollectible)"
                        className="px-2 py-1 rounded-lg text-xs border disabled:opacity-40"
                        style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-muted)" }}
                    >
                        <X className="w-3 h-3" />
                    </button>
                </div>
            </div>
            {showPicker && (
                <WeekPicker
                    weeks={weeks}
                    onPick={scheduleAR}
                    onCancel={() => setShowPicker(false)}
                    saving={saving}
                />
            )}
        </div>
    );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

function BacklogModal({
    backlog,
    weeks,
    companyId,
    onScheduled,
    onClose,
}: Props & { onClose: () => void }) {
    const [refreshKey, setRefreshKey] = useState(0);

    const handleScheduled = () => {
        setRefreshKey(k => k + 1);
        onScheduled();
    };

    const totalItems = backlog.overdueAP.length + backlog.overdueAR.length;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15, 23, 42, 0.4)", backdropFilter: "blur(8px)" }}>
            <div className="border rounded-2xl w-full max-w-2xl max-h-[88vh] overflow-y-auto custom-scrollbar" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>

                {/* Header */}
                <div className="flex items-center justify-between px-6 py-5 border-b sticky top-0 rounded-t-2xl" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                    <div>
                        <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>The Backlog</h2>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                            {totalItems} past-due item{totalItems !== 1 ? "s" : ""} need a place in the forecast
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 flex items-center justify-center rounded-lg border transition-colors"
                        style={{ color: "var(--text-muted)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Explainer */}
                <div className="mx-6 mt-5 rounded-xl px-4 py-3 border" style={{ background: "rgba(120,53,15,0.03)", borderColor: "rgba(251,191,36,0.20)" }}>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                        These items are past their due date and are currently <strong>not included</strong> in your 13-week forecast.
                        Schedule each one into the week you actually expect it to be paid or collected.
                        Until scheduled, they live here — visible but not impacting your runway.
                    </p>
                </div>

                {/* AP Section */}
                {backlog.overdueAP.length > 0 && (
                    <div className="px-6 pt-5">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: "var(--color-danger)" }}>
                                    <ArrowDownRight className="w-3.5 h-3.5" /> Bills to Pay
                                </h3>
                                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                                    Schedule each bill into the week you&apos;ll pay it.
                                </p>
                            </div>
                            <span className="text-xs font-bold font-financial px-3 py-1 rounded border shadow-sm" style={{ color: "var(--color-danger)", background: "rgba(220,38,38,0.03)", borderColor: "rgba(220,38,38,0.1)" }}>
                                {fmt(backlog.totalOverdueAP)}
                            </span>
                        </div>
                        <div className="space-y-2" key={`ap-${refreshKey}`}>
                            {backlog.overdueAP.map(bill => (
                                <APRow key={bill.id} bill={bill} weeks={weeks} companyId={companyId} onScheduled={handleScheduled} />
                            ))}
                        </div>
                    </div>
                )}

                {/* AR Section */}
                {backlog.overdueAR.length > 0 && (
                    <div className="px-6 pt-5 pb-6">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <h3 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1" style={{ color: "var(--color-positive)" }}>
                                    <ArrowUpRight className="w-3.5 h-3.5" /> Invoices to Collect
                                </h3>
                                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                                    &ldquo;Expect in&rdquo; to add to a week. &ldquo;X&rdquo; to write off.
                                </p>
                            </div>
                            <span className="text-xs font-bold font-financial px-3 py-1 rounded border shadow-sm" style={{ color: "var(--color-positive)", background: "rgba(34,197,94,0.03)", borderColor: "rgba(34,197,94,0.1)" }}>
                                {fmt(backlog.totalOverdueAR)}
                            </span>
                        </div>
                        <div className="space-y-2" key={`ar-${refreshKey}`}>
                            {backlog.overdueAR.map(invoice => (
                                <ARRow key={invoice.id} invoice={invoice} weeks={weeks} companyId={companyId} onScheduled={handleScheduled} />
                            ))}
                        </div>
                    </div>
                )}

                {backlog.overdueAP.length === 0 && backlog.overdueAR.length === 0 && (
                    <div className="px-6 py-12 text-center">
                        <div className="flex justify-center mb-3">
                            <CheckCircle className="w-10 h-10 text-emerald-500" />
                        </div>
                        <p className="font-medium" style={{ color: "var(--text-primary)" }}>Backlog is clear</p>
                        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>All AR and AP items are scheduled or written off.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Banner Trigger (shown on dashboard) ─────────────────────────────────────

export function BacklogTriage({ backlog, weeks, companyId, onScheduled }: Props) {
    const [open, setOpen] = useState(false);

    const totalItems = backlog.overdueAP.length + backlog.overdueAR.length;
    if (totalItems === 0) return null;

    const hasAP = backlog.overdueAP.length > 0;
    const hasAR = backlog.overdueAR.length > 0;

    return (
        <>
            {/* Compact banner trigger */}
            <button
                id="backlog-triage-banner"
                onClick={() => setOpen(true)}
                className={`w-full text-left rounded-xl px-5 py-4 border group transition-all duration-300 ${hasAP ? "p1-pulse-light shadow-sm" : ""}`}
                style={{
                    background: hasAP ? "rgba(220,38,38,0.03)" : "rgba(120,53,15,0.03)",
                    borderColor: hasAP ? "rgba(220,38,38,0.15)" : "rgba(251,191,36,0.15)",
                }}
            >
                <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <ClipboardList className="w-5 h-5 text-slate-400" />
                        <div>
                            <p className="text-sm font-semibold transition-colors" style={{ color: "var(--text-primary)" }}>
                                Backlog &mdash; {totalItems} past-due item{totalItems !== 1 ? "s" : ""} need a home in the forecast
                            </p>
                            <div className="flex gap-3 mt-0.5 flex-wrap">
                                {hasAP && (
                                    <span className="text-xs font-financial font-semibold flex items-center gap-1" style={{ color: "var(--color-danger)" }}>
                                        <ArrowDownRight className="w-3.5 h-3.5" /> {backlog.overdueAP.length} bill{backlog.overdueAP.length !== 1 ? "s" : ""} ({fmt(backlog.totalOverdueAP)})
                                    </span>
                                )}
                                {hasAP && hasAR && <span className="text-xs" style={{ color: "var(--text-faint)" }}>·</span>}
                                {hasAR && (
                                    <span className="text-xs font-financial font-semibold flex items-center gap-1" style={{ color: "var(--color-positive)" }}>
                                        <ArrowUpRight className="w-3.5 h-3.5" /> {backlog.overdueAR.length} invoice{backlog.overdueAR.length !== 1 ? "s" : ""} ({fmt(backlog.totalOverdueAR)})
                                    </span>
                                )}
                                <span className="text-xs italic" style={{ color: "var(--text-muted)" }}>Not yet in runway — schedule to include</span>
                            </div>
                        </div>
                    </div>
                    <span className="text-xs font-semibold group-hover:underline shrink-0 tracking-wide transition-all flex items-center gap-1" style={{ color: "var(--color-primary)" }}>
                        Triage <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                </div>
            </button>

            {/* Modal */}
            {open && (
                <BacklogModal
                    backlog={backlog}
                    weeks={weeks}
                    companyId={companyId}
                    onScheduled={() => { onScheduled(); }}
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}
