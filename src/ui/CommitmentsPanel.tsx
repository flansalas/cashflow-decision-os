// ui/CommitmentsPanel.tsx – Recurring Commitments Panel
// Tab 1: "Schedule" — week-by-week collapsible view with reschedule controls
// Tab 2: "Manage"  — existing list with add/edit/toggle/delete
"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Users, Building2, Landmark, Package, Zap, Fuel, Wrench, ClipboardList, CreditCard, Pin, Clock, AlertTriangle, Calendar, Settings, CheckCircle2, Circle, ArrowUpRight, ArrowDownLeft, ChevronDown, ChevronRight, Check, ArrowRight, Pencil, ChevronUp } from "lucide-react";
import { HelpBubble } from "./HelpBubble";

interface Commitment {
    id: string;
    displayName: string;
    category: string;
    cadence: string;
    nextExpectedDate: string | null;
    typicalAmount: number;
    confidence: string;
    isIncluded: boolean;
    isCritical: boolean;
    direction: string;
}

interface WeekBreakdownItem {
    label: string;
    amount: number;
    type: string;
    sourceType: string;
    sourceId?: string;
    confidence: string;
    section?: string;
}

interface ForecastWeek {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    breakdown: {
        outflows: WeekBreakdownItem[];
        inflows: WeekBreakdownItem[];
    };
}

// ── Backlog types (mirrored from BacklogTriage) ──────────────────────────────
interface BacklogBill {
    id: string;
    vendorName: string;
    billNo: string;
    amountOpen: number;
    dueDate: string | null;
    daysPastDue: number | null;
    kind: "ap";
}
interface BacklogInvoice {
    id: string;
    customerName: string;
    invoiceNo: string;
    amountOpen: number;
    dueDate: string | null;
    daysPastDue: number | null;
    kind: "ar";
}
interface BacklogData {
    overdueAP: BacklogBill[];
    overdueAR: BacklogInvoice[];
    totalOverdueAP: number;
    totalOverdueAR: number;
}

interface Props {
    commitments: Commitment[];
    count: number;
    companyId: string;
    weeks?: ForecastWeek[];
    backlog?: BacklogData;
    onChanged?: () => void;
    /** If true, open the panel and switch to the Manage tab */
    openToManage?: boolean;
    /** Callback to reset the openToManage flag in parent */
    onManageOpened?: () => void;
}

function fmt(n: number): string {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0 });
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const categoryIcons: Record<string, React.ReactNode> = {
    payroll: <Users className="w-5 h-5" />, rent: <Building2 className="w-5 h-5" />, loan: <Landmark className="w-5 h-5" />, subscription: <Package className="w-5 h-5" />,
    utilities: <Zap className="w-5 h-5" />, fuel: <Fuel className="w-5 h-5" />, materials: <Wrench className="w-5 h-5" />, taxes: <ClipboardList className="w-5 h-5" />,
    card_payment: <CreditCard className="w-5 h-5" />, other: <Pin className="w-5 h-5" />,
};

const confidenceBadge: Record<string, string> = {
    high: "bg-slate-50 text-slate-600 border-slate-200",
    med: "bg-slate-50 text-slate-600 border-slate-200",
    low: "bg-slate-50 text-slate-600 border-slate-200",
};

const CADENCES = ["weekly", "biweekly", "monthly", "irregular"];
const CATEGORIES = ["other", "rent", "loan", "subscription", "utilities", "fuel", "materials", "taxes", "card_payment", "asset_sale"];

interface EditState { amount: string; nextDate: string; }
interface AddState { displayName: string; category: string; cadence: string; amount: string; nextDate: string; isCritical: boolean; direction: string; }
const EMPTY_ADD: AddState = { displayName: "", category: "other", cadence: "monthly", amount: "", nextDate: "", isCritical: false, direction: "outflow" };

// ── Schedule Tab: week-by-week accordion ─────────────────────────────────────

function WeekRescheduleInline({
    item, companyId, sourceWeekStart, onSaved, onCancel,
}: {
    item: WeekBreakdownItem; companyId: string; sourceWeekStart: string;
    onSaved: () => void; onCancel: () => void;
}) {
    const [targetDate, setTargetDate] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (!targetDate) { setError("Pick a date"); return; }
        setSaving(true);
        setError(null);
        try {
            // Snap to Monday of target week
            const d = new Date(targetDate + "T12:00:00");
            const day = d.getDay();
            d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
            const targetWeekStart = d.toISOString().slice(0, 10);

            const res = await fetch("/api/recurring-reschedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    patternId: item.sourceId,
                    displayName: item.label,
                    amount: item.amount,
                    sourceWeekStart,
                    targetWeekStart,
                    direction: item.section === "Recurring Inflows" ? "inflow" : "outflow", // Added direction
                }),
            });
            if (!res.ok) { const j = await res.json(); setError(j.error ?? "Failed"); setSaving(false); return; }
            onSaved();
        } catch {
            setError("Network error");
            setSaving(false);
        }
    };

    return (
        <div className="mt-2 rounded-xl p-3 space-y-2.5 border shadow-sm" style={{ background: "var(--bg-input)", borderColor: "rgba(79,70,229,0.2)" }}>
            <p className="text-[10px] items-center gap-1.5 font-bold uppercase tracking-widest flex" style={{ color: "var(--color-primary)" }}>
                <Calendar className="w-3 h-3" /> Shift to Week
            </p>
            <p className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                One-time move; the regular schedule won&apos;t change.
            </p>
            {error && <p className="text-xs text-red-500 font-medium">{error}</p>}
            <div className="space-y-2">
                <input
                    type="date"
                    value={targetDate}
                    onChange={e => setTargetDate(e.target.value)}
                    className="w-full border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:border-indigo-500 shadow-sm transition-all"
                    style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                />
                <div className="flex gap-2">
                    <button
                        onClick={handleSave}
                        disabled={saving || !targetDate}
                        className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold rounded-lg disabled:opacity-40 transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5"
                    >
                        {saving ? <span className="animate-pulse">Moving...</span> : <>Move <ArrowRight className="w-3 h-3"/></>}
                    </button>
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border transition-colors hover:bg-black/5"
                        style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Backlog Card (Week 0) ─────────────────────────────────────────────────────

function BacklogCard({
    backlog, weeks, companyId, onScheduled,
}: {
    backlog: BacklogData;
    weeks: { weekNumber: number; weekEnd: string; weekStart: string }[];
    companyId: string;
    onScheduled: () => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const [schedulingId, setSchedulingId] = useState<string | null>(null);
    const [targetWeek, setTargetWeek] = useState("");
    const [saving, setSaving] = useState(false);

    const totalAP = backlog.totalOverdueAP;
    const totalAR = backlog.totalOverdueAR;
    const countAP = backlog.overdueAP.length;
    const countAR = backlog.overdueAR.length;
    const totalItems = countAP + countAR;

    const scheduleItem = async (type: "ap" | "ar", id: string) => {
        if (!targetWeek) return;
        setSaving(true);
        try {
            const week = weeks.find(w => w.weekNumber === Number(targetWeek));
            if (!week) return;
            const endpoint = type === "ap" ? "/api/overrides" : "/api/overrides";
            const body = type === "ap"
                ? { companyId, type: "set_bill_due_date", billId: id, newDueDate: week.weekEnd }
                : { companyId, type: "set_invoice_due_date", invoiceId: id, newDueDate: week.weekEnd };
            await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
            setSchedulingId(null);
            setTargetWeek("");
            onScheduled();
        } finally {
            setSaving(false);
        }
    };

    if (totalItems === 0) return null;

    return (
        <div
            className="flex-shrink-0 rounded-xl border flex flex-col"
            style={{
                width: "172px",
                background: "var(--bg-surface)",
                borderColor: "var(--border-subtle)",
            }}
        >
            {/* Card header */}
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full text-left px-3 pt-3 pb-2.5 rounded-t-xl hover:bg-white/5 transition-colors flex-shrink-0"
            >
                <div className="flex items-center justify-between mb-1">
                    <span className="text-xs items-center gap-1.5 font-semibold tracking-wider uppercase flex" style={{ color: "var(--text-secondary)" }}>
                        <Clock className="w-3.5 h-3.5" /> Backlog
                    </span>
                    <ChevronDown
                        className="w-3.5 h-3.5 transition-transform duration-200"
                        style={{ color: "var(--text-muted)", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
                    />
                </div>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>Past-due · unscheduled</p>
                <div className="mt-2 space-y-0.5">
                    {countAP > 0 && (
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}><ArrowUpRight className="w-3 h-3 text-slate-400"/> {countAP} bills</span>
                            <span className="text-xs font-bold text-slate-600">-{fmt(totalAP)}</span>
                        </div>
                    )}
                    {countAR > 0 && (
                        <div className="flex items-center justify-between">
                            <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}><ArrowDownLeft className="w-3 h-3 text-slate-400"/> {countAR} invoices</span>
                            <span className="text-xs font-bold text-slate-600">+{fmt(totalAR)}</span>
                        </div>
                    )}
                </div>
            </button>

            <div className="h-px mx-3" style={{ background: "var(--border-subtle)" }} />

            {expanded ? (
                <div className="px-2 py-2 space-y-1.5 overflow-y-auto" style={{ maxHeight: "260px" }}>
                    {/* AP Bills */}
                    {backlog.overdueAP.map(bill => (
                        <div key={bill.id}>
                            <div className="rounded-lg px-2 py-1.5 border" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                                <div className="flex items-start justify-between gap-1">
                                    <p className="text-[11px] font-medium flex items-center gap-1.5 leading-snug flex-1 truncate" style={{ color: "var(--text-primary)" }} title={bill.vendorName}>
                                        <ArrowUpRight className="w-3 h-3 text-slate-400 shrink-0"/> {bill.vendorName}
                                    </p>
                                    <span className="text-xs font-bold text-slate-600 shrink-0">-{fmt(bill.amountOpen)}</span>
                                </div>
                                {bill.daysPastDue != null && (
                                    <p className="text-[10px] mt-0.5 text-slate-500 font-medium">{bill.daysPastDue}d overdue</p>
                                )}
                                <button
                                    onClick={() => setSchedulingId(schedulingId === `ap-${bill.id}` ? null : `ap-${bill.id}`)}
                                    className="mt-1 text-[11px] px-1.5 py-0.5 rounded border font-semibold w-full text-center transition-colors flex items-center justify-center gap-1"
                                    style={{ color: "var(--color-primary)", borderColor: "rgba(79,70,229,0.2)", background: "rgba(79,70,229,0.03)" }}
                                >
                                    Schedule to week <ArrowRight className="w-3 h-3" />
                                </button>
                            </div>
                            {schedulingId === `ap-${bill.id}` && (
                                <div className="mt-1 px-1 py-1.5 rounded-lg border space-y-1" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                                    <select
                                        value={targetWeek}
                                        onChange={e => setTargetWeek(e.target.value)}
                                        className="w-full text-[11px] rounded px-1 py-0.5"
                                        style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
                                    >
                                        <option value="">Pick week…</option>
                                        {weeks.map(w => (
                                            <option key={w.weekNumber} value={w.weekNumber}>Week {w.weekNumber} ({fmtDate(w.weekEnd)})</option>
                                        ))}
                                    </select>
                                    <div className="flex gap-1">
                                        <button onClick={() => scheduleItem("ap", bill.id)} disabled={saving || !targetWeek}
                                            className="flex-1 text-[11px] py-0.5 rounded font-bold" style={{ background: "var(--color-primary)", color: "white" }}>
                                            {saving ? "…" : "Save"}
                                        </button>
                                        <button onClick={() => setSchedulingId(null)}
                                            className="flex-1 text-[11px] py-0.5 rounded" style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                    {/* AR Invoices */}
                    {backlog.overdueAR.map(inv => (
                        <div key={inv.id}>
                            <div className="rounded-lg px-2 py-1.5 border" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                                <div className="flex items-start justify-between gap-1">
                                    <p className="text-[11px] font-medium items-center gap-1.5 flex leading-snug flex-1 truncate" style={{ color: "var(--text-primary)" }} title={inv.customerName}>
                                        <ArrowDownLeft className="w-3 h-3 text-slate-400 shrink-0"/> {inv.customerName}
                                    </p>
                                    <span className="text-xs font-bold text-slate-600 shrink-0">+{fmt(inv.amountOpen)}</span>
                                </div>
                                {inv.daysPastDue != null && (
                                    <p className="text-[10px] mt-0.5 text-slate-500 font-medium">{inv.daysPastDue}d overdue</p>
                                )}
                                <button
                                    onClick={() => setSchedulingId(schedulingId === `ar-${inv.id}` ? null : `ar-${inv.id}`)}
                                    className="mt-1 text-[11px] px-1.5 py-0.5 rounded border font-semibold w-full text-center transition-colors flex items-center justify-center gap-1"
                                    style={{ color: "var(--color-primary)", borderColor: "rgba(79,70,229,0.2)", background: "rgba(79,70,229,0.03)" }}
                                >
                                    Schedule to week <ArrowRight className="w-3 h-3" />
                                </button>
                            </div>
                            {schedulingId === `ar-${inv.id}` && (
                                <div className="mt-1 px-1 py-1.5 rounded-lg border space-y-1" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                                    <select
                                        value={targetWeek}
                                        onChange={e => setTargetWeek(e.target.value)}
                                        className="w-full text-[11px] rounded px-1 py-0.5"
                                        style={{ background: "var(--bg-surface)", color: "var(--text-primary)", border: "1px solid var(--border-default)" }}
                                    >
                                        <option value="">Pick week…</option>
                                        {weeks.map(w => (
                                            <option key={w.weekNumber} value={w.weekNumber}>Week {w.weekNumber} ({fmtDate(w.weekEnd)})</option>
                                        ))}
                                    </select>
                                    <div className="flex gap-1">
                                        <button onClick={() => scheduleItem("ar", inv.id)} disabled={saving || !targetWeek}
                                            className="flex-1 text-[11px] py-0.5 rounded font-bold transition-shadow shadow-sm" style={{ background: "var(--color-primary)", color: "white" }}>
                                            {saving ? "…" : "Save"}
                                        </button>
                                        <button onClick={() => setSchedulingId(null)}
                                            className="flex-1 text-[11px] py-0.5 rounded" style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {totalItems} item{totalItems !== 1 ? "s" : ""} need scheduling
                </p>
            )}
        </div>
    );
}

// ── Horizontal Card-Belt: one card per week ──────────────────────────────────

function WeekCard({
    week, companyId, onRescheduled,
}: {
    week: ForecastWeek; companyId: string; onRescheduled: () => void;
}) {
    const recurringOutflows = week.breakdown.outflows.filter(
        o => o.section === "Recurring Commitments"
    );
    const recurringInflows = week.breakdown.inflows.filter(
        i => i.section === "Recurring Inflows"
    );
    const recurringItems = [...recurringInflows, ...recurringOutflows];
    if (recurringItems.length === 0) return null;

    const [expanded, setExpanded] = useState(false);
    const [reschedulingId, setReschedulingId] = useState<string | null>(null);

    const outTotal = recurringOutflows.reduce((s, i) => s + i.amount, 0);
    const inTotal = recurringInflows.reduce((s, i) => s + i.amount, 0);
    const deferredCount = recurringItems.filter(i => i.type === "rescheduled").length;

    return (
        <div
            className="flex-shrink-0 rounded-xl border flex flex-col"
            style={{
                width: "172px",
                background: "var(--bg-surface)",
                borderColor: deferredCount > 0 ? "rgba(79,70,229,0.2)" : "var(--border-subtle)",
            }}
        >
            {/* Card header — click to toggle items */}
            <button
                onClick={() => setExpanded(e => !e)}
                className="w-full text-left px-3 pt-3 pb-2.5 rounded-t-xl hover:bg-black/5 transition-colors flex-shrink-0"
            >
                <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-bold" style={{ color: "var(--text-primary)" }}>Week {week.weekNumber}</span>
                    <ChevronDown
                        className="w-3.5 h-3.5 transition-transform duration-200"
                        style={{ color: "var(--text-muted)", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}
                    />
                </div>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {fmtDate(week.weekStart)} – {fmtDate(week.weekEnd)}
                </p>
                <div className="flex items-center justify-between mt-2">
                    <div className="flex gap-2">
                        {outTotal > 0 && <span className="text-xs font-bold font-financial text-red-600">-{fmt(outTotal)}</span>}
                        {inTotal > 0 && <span className="text-xs font-bold font-financial text-emerald-600">+{fmt(inTotal)}</span>}
                    </div>
                    {deferredCount > 0 && (
                        <span className="text-[11px] px-1 py-0.5 flex items-center gap-0.5 rounded font-semibold" style={{ color: "var(--color-primary)", background: "rgba(79,70,229,0.08)" }}>
                            <AlertTriangle className="w-2.5 h-2.5"/> {deferredCount}
                        </span>
                    )}
                </div>
            </button>

            {/* Divider */}
            <div className="h-px mx-3" style={{ background: "var(--border-subtle)" }} />

            {/* Items — collapsed shows just item count */}
            {expanded ? (
                <div className="px-2 py-2 space-y-1.5 overflow-y-auto" style={{ maxHeight: "260px" }}>
                    {/* Recurring items */}
                    {recurringItems.map((item, idx) => (
                        <div key={idx}>
                            <div
                                className="rounded-lg px-2 py-1.5 border"
                                style={{
                                    background: "var(--bg-raised)",
                                    borderColor: item.type === "rescheduled" ? "rgba(79,70,229,0.15)" : "var(--border-subtle)",
                                }}
                            >
                                <div className="flex items-start justify-between gap-1">
                                    <p className="text-xs items-center gap-1.5 flex font-medium leading-snug truncate flex-1" style={{ color: "var(--text-primary)" }} title={item.label}>
                                        {item.type === "rescheduled" && <Calendar className="w-3 h-3 text-indigo-400 shrink-0"/>} {item.label}
                                    </p>
                                    <span className={`text-xs font-bold font-financial shrink-0 text-slate-600`}>
                                        {item.section === "Recurring Inflows" ? "+" : "-"}{fmt(item.amount)}
                                    </span>
                                </div>
                                {item.sourceType === "recurring" && item.sourceId && item.type !== "rescheduled" && (
                                    <button
                                        onClick={() => setReschedulingId(reschedulingId === `${idx}` ? null : `${idx}`)}
                                        className="mt-1 text-[11px] px-1.5 py-0.5 rounded border font-semibold w-full text-center"
                                        style={{ color: "var(--color-primary)", borderColor: "rgba(79,70,229,0.3)", background: "rgba(79,70,229,0.08)" }}
                                    >
                                        Move to week <ArrowRight className="w-3 h-3 ml-1 inline-block" />
                                    </button>
                                )}
                            </div>
                            {reschedulingId === `${idx}` && item.sourceId && (
                                <WeekRescheduleInline
                                    item={item}
                                    companyId={companyId}
                                    sourceWeekStart={week.weekStart}
                                    onSaved={() => { setReschedulingId(null); onRescheduled(); }}
                                    onCancel={() => setReschedulingId(null)}
                                />
                            )}
                        </div>
                    ))}

                    {/* AR + AP summary lines */}
                    {(() => {
                        const arItems = week.breakdown.outflows.filter(o => o.section === "AR Receipts");
                        const apItems = week.breakdown.outflows.filter(o => o.section === "AP Bills");
                        const arTotal = arItems.reduce((s, i) => s + i.amount, 0);
                        const apTotal = apItems.reduce((s, i) => s + i.amount, 0);
                        return (
                            <>
                                {arItems.length > 0 && (
                                    <div className="rounded-lg px-2 py-1.5 border" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                                                <ArrowDownLeft className="w-3 h-3 text-emerald-500 shrink-0"/> {arItems.length} AR invoice{arItems.length !== 1 ? "s" : ""}
                                            </span>
                                            <span className="text-xs font-bold text-emerald-700">+{fmt(arTotal)}</span>
                                        </div>
                                    </div>
                                )}
                                {apItems.length > 0 && (
                                    <div className="rounded-lg px-2 py-1.5 border" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                                                <ArrowUpRight className="w-3 h-3 text-red-500 shrink-0"/> {apItems.length} AP bill{apItems.length !== 1 ? "s" : ""}
                                            </span>
                                            <span className="text-xs font-bold text-red-600">-{fmt(apTotal)}</span>
                                        </div>
                                    </div>
                                )}
                            </>
                        );
                    })()}
                </div>
            ) : (
                <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {recurringItems.length} item{recurringItems.length !== 1 ? "s" : ""} hidden
                </p>
            )}
        </div>
    );
}

function ScheduleTab({ weeks, companyId, backlog, onRescheduled }: {
    weeks: ForecastWeek[]; companyId: string; backlog?: BacklogData; onRescheduled: () => void;
}) {
    const weeksWithRecurring = weeks.filter(w =>
        w.breakdown.outflows.some(o => o.section === "Recurring Commitments") ||
        w.breakdown.inflows.some(i => i.section === "Recurring Inflows")
    );

    if (weeksWithRecurring.length === 0) {
        return (
            <p className="text-sm py-6 px-4 text-center" style={{ color: "var(--text-muted)" }}>
                No planned items in the 13-week forecast.
            </p>
        );
    }

    const grandTotalOut = weeksWithRecurring.reduce((s, w) =>
        s + w.breakdown.outflows
            .filter(o => o.section === "Recurring Commitments")
            .reduce((sum, i) => sum + i.amount, 0), 0
    );
    const grandTotalIn = weeksWithRecurring.reduce((s, w) =>
        s + w.breakdown.inflows
            .filter(i => i.section === "Recurring Inflows")
            .reduce((sum, i) => sum + i.amount, 0), 0
    );

    return (
        <div>
            {/* Total bar */}
            <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-raised)" }}>
                <span className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>13-Week Master Schedule</span>
                <div className="flex gap-3">
                    {grandTotalOut > 0 && <span className="text-sm font-bold font-financial text-red-600">-{fmt(grandTotalOut)}</span>}
                    {grandTotalIn > 0 && <span className="text-sm font-bold font-financial text-emerald-600">+{fmt(grandTotalIn)}</span>}
                </div>
            </div>

            {/* ── Horizontal Belt ── */}
            <div
                className="flex gap-3 px-4 py-4"
                style={{ overflowX: "auto", scrollbarWidth: "thin", scrollbarColor: "var(--border-default) transparent" }}
            >
                {/* Card 0: Backlog */}
                {backlog && (
                    <BacklogCard
                        backlog={backlog}
                        weeks={weeks.map(w => ({ weekNumber: w.weekNumber, weekEnd: w.weekEnd, weekStart: w.weekStart }))}
                        companyId={companyId}
                        onScheduled={onRescheduled}
                    />
                )}
                {weeks.map(w => {
                    const itemsOut = w.breakdown.outflows.filter(o => o.section === "Recurring Commitments");
                    const itemsIn = w.breakdown.inflows.filter(i => i.section === "Recurring Inflows");
                    if (itemsOut.length === 0 && itemsIn.length === 0) {
                        // Placeholder card — keeps week spacing aligned with chart
                        return (
                            <div
                                key={w.weekNumber}
                                className="flex-shrink-0 rounded-xl border flex flex-col items-center justify-center"
                                style={{ width: "172px", minHeight: "88px", background: "var(--bg-raised)", borderColor: "var(--border-subtle)", opacity: 0.35 }}
                            >
                                <span className="text-xs font-bold" style={{ color: "var(--text-muted)" }}>Week {w.weekNumber}</span>
                                <span className="text-[11px] mt-0.5" style={{ color: "var(--text-faint, #334155)" }}>no commitments</span>
                            </div>
                        );
                    }
                    return (
                        <WeekCard
                            key={w.weekNumber}
                            week={w}
                            companyId={companyId}
                            onRescheduled={onRescheduled}
                        />
                    );
                })}
            </div>
        </div>
    );
}

// ── Manage Tab (existing functionality, preserved entirely) ───────────────────

function ManageTab({ commitments, companyId, onChanged }: {
    commitments: Commitment[];
    companyId: string;
    onChanged?: () => void;
}) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editState, setEditState] = useState<EditState>({ amount: "", nextDate: "" });
    const [saving, setSaving] = useState<string | null>(null);
    const [localCommitments, setLocalCommitments] = useState<Commitment[]>(commitments);
    const [error, setError] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [addState, setAddState] = useState<AddState>(EMPTY_ADD);
    const [addSaving, setAddSaving] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);

    useEffect(() => {
        if (editingId === null) setLocalCommitments(commitments);
    }, [commitments, editingId]);



    const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
        setSaving(id);
        setError(null);
        try {
            const res = await fetch(`/api/commitments/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) { const err = await res.json(); setError(err.error ?? "Save failed"); return false; }
            const updated = await res.json();
            setLocalCommitments(prev => prev.map(c => c.id === id ? { ...c, ...updated } : c));
            onChanged?.();
            return true;
        } catch {
            setError("Network error — try again");
            return false;
        } finally {
            setSaving(null);
        }
    }, [onChanged]);

    const handleDelete = async (c: Commitment) => {
        if (!confirm(`Delete "${c.displayName}" permanently?`)) return;
        setSaving(c.id);
        try {
            const res = await fetch(`/api/commitments/${c.id}`, { method: "DELETE" });
            if (!res.ok) { setError("Failed to delete"); return; }
            setLocalCommitments(prev => prev.filter(x => x.id !== c.id));
            setEditingId(null);
            onChanged?.();
        } catch {
            setError("Network error — try again");
        } finally {
            setSaving(null);
        }
    };

    const handleAddCommitment = async () => {
        setAddError(null);
        const amount = parseFloat(addState.amount);
        if (!addState.displayName.trim()) { setAddError("Name is required"); return; }
        if (isNaN(amount) || amount <= 0) { setAddError("Amount must be positive"); return; }
        if (!addState.nextDate) { setAddError("Next date is required"); return; }

        setAddSaving(true);
        try {
            const res = await fetch("/api/commitments", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, displayName: addState.displayName.trim(), category: addState.category, cadence: addState.cadence, typicalAmount: amount, nextExpectedDate: addState.nextDate, isCritical: addState.isCritical, direction: addState.direction }),
            });
            const data = await res.json();
            if (!res.ok) { setAddError(data.error ?? "Failed to add"); return; }
            setLocalCommitments(prev => [...prev, { ...data, direction: addState.direction }]);
            setAddState(EMPTY_ADD);
            setShowAddForm(false);
            onChanged?.();
        } catch {
            setAddError("Network error — try again");
        } finally {
            setAddSaving(false);
        }
    };

    const sortedCommitments = localCommitments
        .sort((a, b) => {
            const aIsPayroll = a.category === "payroll" || a.displayName.toLowerCase().includes("payroll");
            const bIsPayroll = b.category === "payroll" || b.displayName.toLowerCase().includes("payroll");
            if (aIsPayroll && !bIsPayroll) return -1;
            if (!aIsPayroll && bIsPayroll) return 1;
            return 0;
        });

    return (
        <div className="px-5 pb-4 space-y-1">
            {error && (
                <div className="text-xs text-red-700 border border-red-200 rounded px-3 py-2 mb-2 mt-3 font-medium" style={{ background: "rgba(220,38,38,0.03)" }}>
                    {error}
                </div>
            )}

            {sortedCommitments.length === 0 ? (
                <p className="text-sm py-4" style={{ color: "var(--text-muted)" }}>No planned events yet.</p>
            ) : (
                sortedCommitments.map(c => (
                    <div
                        key={c.id}
                        className={`py-3 border-t first:border-t-0 ${!c.isIncluded ? "opacity-40" : ""}`}
                        style={{ borderColor: "var(--border-subtle)" }}
                    >
                        <div className="flex items-center gap-3">
                            <span className="text-lg shrink-0 flex items-center justify-center p-1.5 rounded-[8px] border" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border-subtle)' }}>
                                {categoryIcons[c.category] || <Pin className="w-5 h-5 text-slate-400" />}
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{c.displayName}</span>
                                    {c.isCritical && (
                                        <span className="text-xs px-1.5 py-0.5 bg-red-50 text-red-700 rounded border border-red-100 font-semibold">Critical</span>
                                    )}
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${confidenceBadge[c.confidence]}`}>{c.confidence}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                                    <span className="capitalize">{c.cadence}</span>
                                    <span>·</span>
                                    <span>Next: {c.nextExpectedDate ? new Date(c.nextExpectedDate).toLocaleDateString() : "TBD"}</span>
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-sm font-bold font-financial" style={{ color: "var(--text-primary)" }}>{fmt(c.typicalAmount)}</p>
                            </div>
                        </div>

                        {/* Inline edit form */}
                        {editingId === c.id && (
                            <div className="mt-3 border rounded-lg p-3 space-y-2" style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)" }}>
                                <div className="flex gap-3">
                                    <div className="flex-1">
                                        <label className="text-xs block mb-1 uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>Amount ($)</label>
                                        <input
                                            type="number"
                                            value={editState.amount}
                                            onChange={e => setEditState(s => ({ ...s, amount: e.target.value }))}
                                            className="w-full border rounded px-3 py-1.5 text-sm font-financial font-bold focus:outline-none focus:border-blue-500"
                                            style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                                            min={0} step={100}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-xs block mb-1 uppercase tracking-wider font-semibold" style={{ color: "var(--text-muted)" }}>Next Date</label>
                                        <input
                                            type="date"
                                            value={editState.nextDate}
                                            onChange={e => setEditState(s => ({ ...s, nextDate: e.target.value }))}
                                            className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                                            style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                                        />
                                    </div>
                                </div>
                                <div className="flex gap-2 pt-1">
                                    <button
                                        onClick={async () => {
                                            const amount = parseFloat(editState.amount);
                                            if (isNaN(amount) || amount <= 0) { setError("Amount must be positive"); return; }
                                            const ok = await patch(c.id, { typicalAmount: amount, nextExpectedDate: editState.nextDate || null });
                                            if (ok) setEditingId(null);
                                        }}
                                        disabled={saving === c.id}
                                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded font-semibold disabled:opacity-40 shadow-sm transition-colors"
                                    >
                                        {saving === c.id ? "Saving…" : "Save"}
                                    </button>
                                    <button onClick={() => handleDelete(c)} disabled={saving === c.id} className="px-3 py-1.5 text-red-700 text-xs rounded border border-red-100 disabled:opacity-40 hover:bg-red-50 transition-colors shadow-sm" style={{ background: "var(--bg-surface)" }}>Delete</button>
                                    <button onClick={() => { setEditingId(null); setError(null); }} className="px-3 py-1.5 text-xs rounded border hover:bg-black/5 transition-colors" style={{ color: "var(--text-muted)", background: "var(--bg-raised)", borderColor: "var(--border-default)" }}>Cancel</button>
                                </div>
                            </div>
                        )}

                        {/* Control row */}
                        <div className="flex items-center gap-2 mt-2">
                            <button
                                onClick={() => patch(c.id, { isIncluded: !c.isIncluded })}
                                disabled={saving === c.id}
                                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border disabled:opacity-40 transition-all shadow-sm ${c.isIncluded
                                        ? "border-slate-300 text-slate-700 bg-slate-50"
                                        : "border-slate-200 text-slate-500 bg-slate-50"
                                    }`}
                            >
                                <span>{c.isIncluded ? <Check className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}</span>
                                <span>{c.isIncluded ? "In Forecast" : "Excluded"}</span>
                            </button>
                            <button
                                onClick={() => patch(c.id, { isCritical: !c.isCritical })}
                                disabled={saving === c.id}
                                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border disabled:opacity-40 transition-all shadow-sm ${c.isCritical
                                        ? "border-red-200 text-red-700 bg-red-50"
                                        : "border-gray-200 text-gray-500 bg-gray-50"
                                    }`}
                            >
                                <span>{c.isCritical ? <Circle className="w-3.5 h-3.5 fill-current text-red-600"/> : <Circle className="w-3.5 h-3.5 text-gray-400"/>}</span>
                                <span>Critical</span>
                            </button>
                            {editingId !== c.id && (
                                <button
                                    onClick={() => {
                                        setEditingId(c.id);
                                        setEditState({
                                            amount: String(c.typicalAmount),
                                            nextDate: c.nextExpectedDate ? new Date(c.nextExpectedDate).toISOString().slice(0, 10) : "",
                                        });
                                        setError(null);
                                    }}
                                    className="px-2 py-1 rounded text-xs border ml-auto"
                                    style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}
                                >
                                    <Pencil className="w-3 h-3 inline-block mr-1" /> Edit
                                </button>
                            )}
                        </div>
                    </div>
                ))
            )}

            {/* Add Commitment */}
            {showAddForm ? (
                <div className="border-t pt-4 mt-2" style={{ borderColor: "var(--border-subtle)" }}>
                    <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>+ New Planned Event</p>
                    {addError && (
                        <div className="text-xs text-red-700 border border-red-200 rounded px-3 py-2 mb-3 font-medium" style={{ background: "rgba(220,38,38,0.03)" }}>{addError}</div>
                    )}
                    <div className="space-y-2">
                        <input type="text" value={addState.displayName} onChange={e => setAddState(s => ({ ...s, displayName: e.target.value }))} placeholder="Name (e.g. Office Rent, Insurance)" className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 shadow-sm" style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                        <div className="grid grid-cols-2 gap-2">
                            <input type="number" value={addState.amount} onChange={e => setAddState(s => ({ ...s, amount: e.target.value }))} placeholder="Amount ($)" min={0} className="border rounded-lg px-3 py-2 text-sm font-financial font-bold focus:outline-none focus:border-blue-500 shadow-sm" style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                            <input type="date" value={addState.nextDate} onChange={e => setAddState(s => ({ ...s, nextDate: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 shadow-sm" style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <select value={addState.direction} onChange={e => setAddState(s => ({ ...s, direction: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 shadow-sm" style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                <option value="outflow">Money Out (Expense)</option>
                                <option value="inflow">Money In (Revenue)</option>
                            </select>
                            <select value={addState.cadence} onChange={e => setAddState(s => ({ ...s, cadence: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 shadow-sm" style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                {CADENCES.map(c => <option key={c} value={c}>{c === "irregular" ? "one-time" : c}</option>)}
                            </select>
                            <select value={addState.category} onChange={e => setAddState(s => ({ ...s, category: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500 shadow-sm col-span-2" style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <button
                            onClick={() => setAddState(s => ({ ...s, isCritical: !s.isCritical }))}
                            className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded border ${addState.isCritical
                                    ? "border-red-200 text-red-800 bg-red-50"
                                    : "border-gray-200 text-gray-500 bg-gray-50"
                                }`}
                        >
                            {addState.isCritical ? <><AlertTriangle className="w-3 h-3 inline-block mr-1" /> Critical — click to unmark</> : <><Circle className="w-3 h-3 inline-block mr-1" /> Mark as critical</>}
                        </button>
                        <div className="flex gap-2 pt-1">
                            <button onClick={handleAddCommitment} disabled={addSaving} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg disabled:opacity-40">
                                {addSaving ? "Saving…" : <><CheckCircle2 className="w-4 h-4 inline-block mr-1.5" /> Add to Forecast</>}
                            </button>
                            <button onClick={() => { setShowAddForm(false); setAddState(EMPTY_ADD); setAddError(null); }} className="px-4 py-2 text-sm rounded-lg border" style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}>
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <button 
                    id="spotlight-add-event"
                    onClick={() => setShowAddForm(true)} 
                    className="w-full mt-3 py-2 text-xs border border-dashed rounded-lg focus:outline-none transition-colors hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50"
                    style={{ color: "var(--text-muted)", borderColor: "var(--border-default)" }}
                >
                    + Add planned event
                </button>
            )}
        </div>
    );
}

// ── Main exported component ────────────────────────────────────────────────────

export function CommitmentsPanel({ commitments, count, companyId, weeks, backlog, onChanged, openToManage, onManageOpened }: Props) {
    const [open, setOpen] = useState(true);
    const [tab, setTab] = useState<"schedule" | "manage">("schedule");
    const panelRef = useRef<HTMLDivElement>(null);

    const hasScheduleData = (weeks?.length ?? 0) > 0;

    // When the tracker requests manage tab, open panel + switch tab
    useEffect(() => {
        if (openToManage) {
            setOpen(true);
            setTab("manage");
            onManageOpened?.();
            setTimeout(() => {
                panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 50);
        }
    }, [openToManage, onManageOpened]);

    return (
        <div ref={panelRef} className="rounded-xl border" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
            {/* Panel header */}
            {/* Panel header — div instead of <button> to avoid nested button (HelpBubble is a button) */}
            <div
                className="w-full px-5 py-4 flex items-center justify-between cursor-pointer hover:opacity-80"
                onClick={() => setOpen(!open)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === "Enter" || e.key === " " ? setOpen(!open) : undefined}
            >
                <div className="flex items-center gap-2 text-left">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                        The Cash Belt
                    </span>
                    <HelpBubble text="Your recurring promises — rent, loans, utilities, and payroll. We track these so you never forget a payment and your forecast stays accurate." />
                </div>
                
                <div className="flex items-center gap-2 ml-auto">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full border" style={{ color: "var(--text-muted)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}>
                        {count}
                    </span>
                    <span className="text-slate-400">
                        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </span>
                </div>
            </div>

            {open && (
                <div className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
                    {/* Tab switcher */}
                    {hasScheduleData && (
                        <div className="flex border-b" style={{ borderColor: "var(--border-subtle)" }}>
                            {([
                                { id: "schedule", label: <span className="flex items-center justify-center gap-1.5"><Calendar className="w-4 h-4" /> Schedule <HelpBubble text="View exactly when cash leaves your bank. Drag to reschedule or manage backlog items." /></span> },
                                { id: "manage", label: <span className="flex items-center justify-center gap-1.5"><Settings className="w-4 h-4" /> Manage <HelpBubble text="Edit your recurring promises setup, typical amounts, and cadence." /></span> },
                            ] as const).map(t => (
                                <button
                                    key={t.id}
                                    onClick={() => setTab(t.id)}
                                    className="flex-1 py-2.5 text-[11px] font-semibold transition-colors"
                                    style={tab === t.id
                                        ? { color: "var(--color-primary)", borderBottom: "2px solid var(--color-primary)" }
                                        : { color: "var(--text-muted)", borderBottom: "2px solid transparent" }
                                    }
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Tab content */}
                    {tab === "schedule" && hasScheduleData ? (
                        <ScheduleTab
                            weeks={weeks!}
                            companyId={companyId}
                            backlog={backlog}
                            onRescheduled={() => onChanged?.()}
                        />
                    ) : (
                        <ManageTab
                            commitments={commitments}
                            companyId={companyId}
                            onChanged={onChanged}
                        />
                    )}
                </div>
            )}
        </div>
    );
}
