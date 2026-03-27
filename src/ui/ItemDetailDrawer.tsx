// ui/ItemDetailDrawer.tsx — Right-sidebar Decision Panel for a selected AR/AP card
"use client";

import { useState } from "react";
import { Hourglass, Package } from "lucide-react";
import type { GridItem } from "./ARAPCard";

interface Props {
    item: GridItem;
    weeks: { weekNumber: number; weekStart: string; weekEnd: string }[];
    companyId: string;
    onMoved: () => void;
    onClose: () => void;
}

function fmt(n: number): string {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateShort(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

const riskColors: Record<string, { color: string; bg: string; label: string }> = {
    low:      { color: "var(--color-positive)", bg: "rgba(34,197,94,0.08)", label: "Low Risk" },
    med:      { color: "#eab308", bg: "rgba(234,179,8,0.08)", label: "Medium Risk" },
    high:     { color: "var(--color-danger)", bg: "rgba(239,68,68,0.08)", label: "High Risk" },
    normal:   { color: "var(--color-primary)", bg: "rgba(79,70,229,0.08)", label: "Normal" },
    critical: { color: "var(--color-danger)", bg: "rgba(239,68,68,0.08)", label: "Critical" },
};

function AgingBar({ days }: { days: number | null | undefined }) {
    if (days == null) return null;

    let label = "";
    let color = "";
    let severity = 0; // 0–4

    if (days <= 0) {
        label = days === 0 ? "Due today" : `Due in ${Math.abs(days)}d`;
        color = "var(--color-positive)";
        severity = 0;
    } else if (days <= 14) {
        label = `${days}d past due — follow up`;
        color = "var(--text-muted)";
        severity = 1;
    } else if (days <= 30) {
        label = `${days}d past due — action needed`;
        color = "#eab308";
        severity = 2;
    } else if (days <= 60) {
        label = "var(--color-danger)";
        color = "var(--color-danger)";
        severity = 3;
    } else {
        label = `${days}d past due — critical`;
        color = "#dc2626";
        severity = 4;
    }

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color }}>
                    {label}
                </span>
            </div>
            {/* Bar */}
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-raised)" }}>
                <div
                    className="h-full rounded-full transition-all"
                    style={{
                        width: `${Math.min(100, (severity / 4) * 100)}%`,
                        background: color,
                    }}
                />
            </div>
        </div>
    );
}

export function ItemDetailDrawer({ item, weeks, companyId, onMoved, onClose }: Props) {
    const [targetWeek, setTargetWeek] = useState<number>(item.effectiveWeek ?? 1);
    const [saving, setSaving] = useState(false);
    const [parking, setParking] = useState(false);
    const [undoing, setUndoing] = useState(false);

    const isAR = item.kind === "ar";
    const isOverridden = !!item.overrideDate;
    const overrideType = isAR ? "set_expected_payment_date" : "set_bill_due_date";
    const targetType = isAR ? "invoice" : "bill";
    const riskInfo = riskColors[item.risk] ?? riskColors["normal"];

    const handleMove = async () => {
        const wk = weeks.find(w => w.weekNumber === targetWeek);
        if (!wk) return;
        if (targetWeek === item.effectiveWeek) return;

        const weekStart = new Date(wk.weekStart);
        const friday = new Date(weekStart);
        friday.setDate(friday.getDate() + 4);
        const dateStr = friday.toISOString().slice(0, 10);

        setSaving(true);
        try {
            if (isOverridden) {
                await fetch(`/api/overrides?targetId=${item.id}&type=${overrideType}`, { method: "DELETE" });
            }
            await fetch("/api/overrides", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, type: overrideType, targetType, targetId: item.id, effectiveDate: dateStr }),
            });
            onMoved();
        } catch { /* ignore */ }
        finally { setSaving(false); }
    };

    const handleParkInBacklog = async () => {
        const farFuture = new Date();
        farFuture.setDate(farFuture.getDate() + 14 * 7);
        const dateStr = farFuture.toISOString().slice(0, 10);
        setParking(true);
        try {
            if (isOverridden) {
                await fetch(`/api/overrides?targetId=${item.id}&type=${overrideType}`, { method: "DELETE" });
            }
            await fetch("/api/overrides", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, type: overrideType, targetType, targetId: item.id, effectiveDate: dateStr }),
            });
            onMoved();
            onClose();
        } catch { /* ignore */ }
        finally { setParking(false); }
    };

    const handleUndo = async () => {
        setUndoing(true);
        try {
            await fetch(`/api/overrides?targetId=${item.id}&type=${overrideType}`, { method: "DELETE" });
            onMoved();
        } catch { /* ignore */ }
        finally { setUndoing(false); }
    };

    // Original due date vs effective date for "social capital" delta
    const originalDue = item.dueDate;
    const effectiveDateStr = isAR ? item.expectedDate : item.effectiveDate;
    const deltaDays = originalDue && effectiveDateStr
        ? Math.round((new Date(effectiveDateStr).getTime() - new Date(originalDue).getTime()) / 86400000)
        : null;

    return (
        <div
            className="flex flex-col h-full overflow-hidden"
            style={{ color: "var(--text-secondary)" }}
        >
            {/* Header */}
            <div
                className="px-4 py-3 border-b flex items-start justify-between shrink-0"
                style={{
                    borderColor: isAR ? "rgba(34,197,94,0.1)" : "rgba(220,38,38,0.1)",
                    background: isAR ? "rgba(34,197,94,0.03)" : "rgba(220,38,38,0.03)",
                }}
            >
                <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5 mb-0.5">
                        <span
                            className="text-[11px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                            style={{
                                color: isAR ? "var(--color-positive)" : "var(--color-danger)",
                                background: isAR ? "rgba(34,197,94,0.08)" : "rgba(220,38,38,0.08)",
                            }}
                        >
                            {isAR ? "AR · Invoice" : "AP · Bill"}
                        </span>
                        <span
                            className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                            style={{ color: riskInfo.color, background: riskInfo.bg }}
                        >
                            {riskInfo.label}
                        </span>
                    </div>
                    <p className="text-sm font-bold leading-tight truncate" style={{ color: "var(--text-primary)" }}>
                        {isAR ? item.customerName : item.vendorName}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>
                        {isAR ? item.invoiceNo : item.billNo}
                    </p>
                </div>
                <button
                    onClick={onClose}
                    className="text-gray-600 hover:text-gray-400 text-sm shrink-0 mt-0.5"
                >×</button>
            </div>

            {/* Body — scrollable */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

                {/* ── Amount ────────────────────────────────────────────── */}
                <div>
                    <p className="text-[11px] uppercase tracking-widest font-bold mb-2" style={{ color: "var(--text-faint)" }}>
                        Amount
                    </p>
                    <div className="flex items-baseline gap-2">
                        <span className={`text-2xl font-bold font-financial ${isAR ? "text-emerald-700" : "text-red-600"}`}>
                            {isAR ? "+" : "−"}{fmt(item.amountOpen)}
                        </span>
                        {item.originalAmount != null && item.originalAmount !== item.amountOpen && (
                            <span className="text-xs line-through" style={{ color: "var(--text-faint)" }}>
                                {fmt(item.originalAmount)}
                            </span>
                        )}
                    </div>
                </div>

                {/* ── Aging ─────────────────────────────────────────────── */}
                <div>
                    <p className="text-[11px] uppercase tracking-widest font-bold mb-2" style={{ color: "var(--text-faint)" }}>
                        Aging
                    </p>
                    <AgingBar days={item.daysPastDue} />
                </div>

                {/* ── Key Dates ─────────────────────────────────────────── */}
                <div>
                    <p className="text-[11px] uppercase tracking-widest font-bold mb-2" style={{ color: "var(--text-faint)" }}>
                        Key Dates
                    </p>
                    <div className="space-y-1.5 text-[11px]">
                        {isAR && item.invoiceDate && (
                            <div className="flex justify-between">
                                <span style={{ color: "var(--text-faint)" }}>Invoice date</span>
                                <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{fmtDate(item.invoiceDate)}</span>
                            </div>
                        )}
                        {!isAR && item.billDate && (
                            <div className="flex justify-between">
                                <span style={{ color: "var(--text-faint)" }}>Bill date</span>
                                <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{fmtDate(item.billDate)}</span>
                            </div>
                        )}
                        {item.dueDate && (
                            <div className="flex justify-between">
                                <span style={{ color: "var(--text-faint)" }}>Original due</span>
                                <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{fmtDate(item.dueDate)}</span>
                            </div>
                        )}
                        {effectiveDateStr && (
                            <div className="flex justify-between">
                                <span style={{ color: "var(--text-faint)" }}>Scheduled for</span>
                                <span className="font-medium" style={{ color: "var(--text-primary)" }}>{fmtDate(effectiveDateStr)}</span>
                            </div>
                        )}
                    </div>

                    {/* Delta badge: social capital indicator */}
                    {deltaDays != null && deltaDays !== 0 && (
                        <div
                            className="mt-2.5 rounded-lg px-3 py-2 text-xs leading-relaxed"
                            style={{
                                background: deltaDays > 0
                                    ? "rgba(220,38,38,0.03)"
                                    : "rgba(34,197,94,0.03)",
                                borderColor: deltaDays > 0
                                    ? "rgba(220,38,38,0.1)"
                                    : "rgba(34,197,94,0.1)",
                                border: "1px solid",
                                color: deltaDays > 0 ? "var(--color-danger)" : "var(--color-positive)",
                            }}
                        >
                            {deltaDays > 0
                                ? `⚠ Scheduled ${deltaDays}d after original due date — ${deltaDays > 30 ? "high" : deltaDays > 14 ? "moderate" : "low"} relationship risk`
                                : `✓ Scheduled ${Math.abs(deltaDays)}d before due date — on track`
                            }
                        </div>
                    )}
                </div>

                {/* ── Move history ──────────────────────────────────────── */}
                {(item.moveCount ?? 0) > 0 && (
                    <div>
                        <p className="text-[11px] uppercase tracking-widest font-bold mb-2" style={{ color: "var(--text-faint)" }}>
                            Move History
                        </p>
                        <div
                            className="rounded-lg px-3 py-2.5 text-xs space-y-1"
                            style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.18)" }}
                        >
                            <div className="flex items-center gap-1.5">
                                <span className="font-bold" style={{ color: "var(--color-primary)" }}>{item.moveCount}&times;</span>
                                <span style={{ color: "var(--text-secondary)" }}>
                                    {item.moveCount === 1 ? "Rescheduled once" : `Rescheduled ${item.moveCount} times`}
                                </span>
                            </div>
                            {(item.moveCount ?? 0) >= 3 && (
                                <p className="text-amber-700 text-[11px] font-semibold">
                                    ⚠ Repeatedly deferred — consider a direct conversation or payment plan
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* ── Action Footer ─────────────────────────────────────────── */}
            <div
                className="px-4 py-4 border-t space-y-3 shrink-0"
                style={{ borderColor: "var(--border-subtle)" }}
            >
                {/* Move to week */}
                <div>
                    <p className="text-[11px] uppercase tracking-widest font-bold mb-1.5" style={{ color: "var(--text-faint)" }}>
                        Move to week
                    </p>
                    <select
                        value={targetWeek}
                        onChange={e => setTargetWeek(parseInt(e.target.value))}
                        className="w-full border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500 shadow-sm"
                        style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                    >
                        {weeks.map(w => (
                            <option key={w.weekNumber} value={w.weekNumber}>
                                W{w.weekNumber} ({fmtDateShort(w.weekStart)} – {fmtDateShort(w.weekEnd)})
                                {w.weekNumber === item.effectiveWeek ? " (current)" : ""}
                            </option>
                        ))}
                    </select>
                    <div className="flex gap-1.5 mt-1.5">
                        <button
                            onClick={handleMove}
                            disabled={saving || targetWeek === item.effectiveWeek}
                            className="flex-1 py-1.5 text-[11px] font-semibold rounded disabled:opacity-40 transition-all shadow-md shadow-indigo-100"
                            style={{ background: "var(--color-primary)", color: "#fff" }}
                        >
                            {saving ? (item.effectiveWeek === null ? "Recovering…" : "Moving…") : (item.effectiveWeek === null ? "Recover to grid" : "Move here")}
                        </button>
                        {isOverridden && (
                            <button
                                onClick={handleUndo}
                                disabled={undoing}
                                className="px-2.5 py-1.5 text-[11px] rounded border disabled:opacity-40"
                                style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}
                            >
                                {undoing ? "…" : "Undo"}
                            </button>
                        )}
                    </div>
                </div>

                {/* Park in Backlog */}
                {item.effectiveWeek !== null && (
                    <>
                        <button
                            onClick={handleParkInBacklog}
                            disabled={parking}
                            className="w-full flex items-center justify-center gap-1.5 py-2 text-[11px] font-semibold rounded border transition-all disabled:opacity-40 shadow-sm"
                            style={{
                                color: "var(--color-primary)",
                                borderColor: "var(--border-default)",
                                background: "var(--bg-raised)",
                            }}
                        >
                            {parking ? <Hourglass className="w-3.5 h-3.5" /> : <Package className="w-3.5 h-3.5" />}
                            <span>{parking ? "Parking…" : "Park in Backlog"}</span>
                        </button>
                        <p className="text-center text-[11px]" style={{ color: "var(--text-faint)" }}>
                            Removes from 13-week math · recoverable anytime
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
