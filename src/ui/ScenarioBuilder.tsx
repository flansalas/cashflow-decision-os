// ui/ScenarioBuilder.tsx – Persisted what-if scenario panel with edit/delete
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Zap, CheckCircle, Pencil, X, ChevronUp, ChevronDown } from "lucide-react";
import { HelpBubble } from "./HelpBubble";

export interface ScenarioItem {
    id: string;
    label: string;
    direction: "in" | "out";
    weekNumber: number;
    amount: number;
}

interface WeekLabel {
    weekNumber: number;
    weekEnd: string;
}

interface Props {
    companyId: string;
    weeks: WeekLabel[];
    items: ScenarioItem[];
    onAdd: (item: ScenarioItem) => void;
    onUpdate: (item: ScenarioItem) => void;
    onRemove: (id: string) => void;
    onClear: () => void;
    onLoad: (items: ScenarioItem[]) => void;
}

function fmtDate(dateStr: string): string {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

const EMPTY_FORM = { label: "", direction: "out" as "in" | "out", fromWeekNumber: 1, toWeekNumber: 1, amount: "" };

export function ScenarioBuilder({ companyId, weeks, items, onAdd, onUpdate, onRemove, onClear, onLoad }: Props) {
    const [open, setOpen] = useState(items.length > 0);
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const itemLabelRef = useRef<HTMLInputElement>(null);
    const [, setFormError] = useState<string | null>(null);
    const [bulkResults, setBulkResults] = useState<{ count: number; label: string } | null>(null);
    const [saving, setSaving] = useState(false);

    // Edit state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editForm, setEditForm] = useState(EMPTY_FORM);
    const [editError, setEditError] = useState<string | null>(null);
    const [editSaving, setEditSaving] = useState(false);

    const [deleting, setDeleting] = useState<string | null>(null);
    const [clearSaving, setClearSaving] = useState(false);

    // Auto-focus when form is shown
    useEffect(() => {
        if (showForm && itemLabelRef.current) {
            itemLabelRef.current.focus();
        }
    }, [showForm]);

    const hasItems = items.length > 0;

    // Load from DB on mount
    useEffect(() => {
        if (!companyId) return;
        fetch(`/api/scenarios?companyId=${companyId}`)
            .then(r => r.json())
            .then(data => { 
                if (Array.isArray(data)) {
                    onLoad(data); 
                    if (data.length > 0) setOpen(true);
                }
            })
            .catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [companyId]);

    const handleAdd = useCallback(async () => {
        setFormError(null);
        setBulkResults(null);
        const amount = parseFloat(String(form.amount));
        if (!form.label.trim()) { setFormError("Label is required"); return; }
        if (isNaN(amount) || amount <= 0) { setFormError("Amount must be a positive number"); return; }

        setSaving(true);
        try {
            const startW = Math.min(form.fromWeekNumber, form.toWeekNumber);
            const endW = Math.max(form.fromWeekNumber, form.toWeekNumber);

            const promises = [];
            for (let w = startW; w <= endW; w++) {
                promises.push(fetch("/api/scenarios", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        companyId,
                        label: form.label.trim(),
                        direction: form.direction,
                        weekNumber: w,
                        amount
                    }),
                }));
            }

            const responses = await Promise.all(promises);
            const items = await Promise.all(responses.map(r => r.json()));

            const firstError = items.find(i => i.error);
            if (firstError) { setFormError(firstError.error); return; }

            // Add all created items to the state
            items.forEach(item => onAdd(item));

            setBulkResults({ count: items.length, label: form.label.trim() });
            setForm(EMPTY_FORM);

            // Auto-hide after 2s if bulk
            if (items.length > 1) {
                setTimeout(() => {
                    setBulkResults(null);
                    setShowForm(false);
                }, 2000);
            } else {
                setShowForm(false);
            }
        } catch { setFormError("Network error"); }
        finally { setSaving(false); }
    }, [companyId, form, onAdd]);

    const handleStartEdit = (item: ScenarioItem) => {
        setEditingId(item.id);
        setEditForm({
            label: item.label,
            direction: item.direction,
            fromWeekNumber: item.weekNumber,
            toWeekNumber: item.weekNumber,
            amount: String(item.amount)
        });
        setEditError(null);
    };

    const handleSaveEdit = useCallback(async (id: string) => {
        setEditError(null);
        const amount = parseFloat(String(editForm.amount));
        if (!editForm.label.trim()) { setEditError("Label is required"); return; }
        if (isNaN(amount) || amount <= 0) { setEditError("Amount must be positive"); return; }

        setEditSaving(true);
        try {
            const res = await fetch(`/api/scenarios/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    label: editForm.label.trim(),
                    direction: editForm.direction,
                    weekNumber: editForm.fromWeekNumber,
                    amount
                }),
            });
            const data = await res.json();
            if (!res.ok) { setEditError(data.error ?? "Failed to save"); return; }
            onUpdate(data);
            setEditingId(null);
        } catch { setEditError("Network error"); }
        finally { setEditSaving(false); }
    }, [editForm, onUpdate]);

    const handleDelete = useCallback(async (id: string) => {
        setDeleting(id);
        try {
            await fetch(`/api/scenarios/${id}`, { method: "DELETE" });
            onRemove(id);
            if (editingId === id) setEditingId(null);
        } catch { }
        finally { setDeleting(null); }
    }, [onRemove, editingId]);

    const handleClearAll = useCallback(async () => {
        if (!confirm("Remove all what-if scenario items?")) return;
        setClearSaving(true);
        try {
            await Promise.all(items.map(i => fetch(`/api/scenarios/${i.id}`, { method: "DELETE" })));
            onClear();
        } catch { }
        finally { setClearSaving(false); }
    }, [items, onClear]);

    return (
        <div className={`rounded-xl border shadow-sm`} style={{
            background: "var(--bg-surface)",
            borderColor: "var(--border-subtle)",
        }}>
            {/* Header — div not button, to avoid nested <button> (HelpBubble is a button) */}
            <div
                className="w-full px-5 py-4 flex items-center gap-3 text-left hover:bg-slate-50 active:bg-slate-100 transition-colors rounded-xl cursor-pointer select-none group/header"
                onClick={() => setOpen(!open)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === "Enter" || e.key === " " ? setOpen(!open) : undefined}
            >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${hasItems ? "bg-amber-100 text-amber-700 shadow-sm" : "bg-slate-100 text-slate-400"}`}>
                    <Zap className="w-4.5 h-4.5" />
                </div>
                <div>
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.15em]" style={{ color: hasItems ? "#f59e0b" : "var(--text-muted)" }}>What-If Scenarios</h3>
                    <p className="text-xs" style={{ color: "var(--text-faint)" }}>Model future cash events instantly</p>
                </div>
                {hasItems && (
                    <span className="ml-2 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider" style={{ background: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.25)", color: "#f59e0b" }}>
                        {items.length} ACTIVE
                    </span>
                )}
                <span className="ml-auto flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 opacity-0 group-hover/header:opacity-100 transition-opacity">
                    {open ? "Collapse" : "Expand"}
                    <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
                </span>
            </div>

            {open && (
                <div className="px-5 pb-4 space-y-2 border-t" style={{ borderColor: "var(--border-subtle)" }}>
                    {/* Active items */}
                    {items.map(item => {
                        const wk = weeks.find(w => w.weekNumber === item.weekNumber);
                        const dateLabel = wk ? fmtDate(wk.weekEnd) : "";
                        const isEditing = editingId === item.id;

                        return (
                            <div key={item.id} className="rounded-lg border mt-2" style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)" }}>
                                {/* Item row */}
                                {!isEditing ? (
                                    <div className="flex items-center gap-2 px-3 py-2.5">
                                        <span className={`text-sm font-bold shrink-0 ${item.direction === "in" ? "text-emerald-600" : "text-red-500"}`}>
                                            {item.direction === "in" ? "+" : "−"}
                                        </span>
                                        <span className="text-sm flex-1 truncate" style={{ color: "var(--text-primary)" }}>{item.label}</span>
                                        <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>Week {item.weekNumber} ({dateLabel})</span>
                                        <span className={`text-sm font-bold font-financial shrink-0 ${item.direction === "in" ? "text-emerald-600" : "text-red-500"}`}>
                                            ${item.amount.toLocaleString()}
                                        </span>
                                        <button
                                            onClick={() => handleStartEdit(item)}
                                            className="text-xs px-1.5 py-0.5 rounded border shrink-0"
                                            style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--bg-input)" }}
                                        >
                                            <Pencil className="w-3 h-3" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(item.id)}
                                            disabled={deleting === item.id}
                                            className="text-xs px-1.5 py-0.5 rounded border shrink-0 disabled:opacity-40"
                                            style={{ color: "#f87171", borderColor: "rgba(248,113,113,0.20)", background: "rgba(248,113,113,0.05)" }}
                                        >
                                            {deleting === item.id ? "…" : <X className="w-3.5 h-3.5" />}
                                        </button>
                                    </div>
                                ) : (
                                    /* Inline Edit Form */
                                    <div className="p-3 space-y-2">
                                        {editError && (
                                            <p className="text-xs text-red-400 border border-red-800/50 rounded px-2 py-1" style={{ background: "rgba(127,29,29,0.15)" }}>{editError}</p>
                                        )}
                                        <input
                                            type="text"
                                            value={editForm.label}
                                            onChange={e => setEditForm(f => ({ ...f, label: e.target.value }))}
                                            className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                                            style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                                        />
                                        <div className="grid grid-cols-3 gap-2">
                                            <select
                                                value={editForm.direction}
                                                onChange={e => setEditForm(f => ({ ...f, direction: e.target.value as "in" | "out" }))}
                                                className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                                            >
                                                <option value="out">Money Out</option>
                                                <option value="in">Money In</option>
                                            </select>
                                            <select
                                                value={editForm.fromWeekNumber}
                                                onChange={e => setEditForm(f => ({ ...f, fromWeekNumber: parseInt(e.target.value) }))}
                                                className="border rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                                            >
                                                {weeks.map(w => (
                                                    <option key={w.weekNumber} value={w.weekNumber}>
                                                        Week {w.weekNumber} ({fmtDate(w.weekEnd)})
                                                    </option>
                                                ))}
                                            </select>
                                            <input
                                                type="number"
                                                value={editForm.amount}
                                                onChange={e => setEditForm(f => ({ ...f, amount: e.target.value }))}
                                                min={0}
                                                className="border rounded px-2 py-1.5 text-sm font-financial focus:outline-none focus:border-blue-500"
                                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleSaveEdit(item.id)} disabled={editSaving} className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded disabled:opacity-40">
                                                {editSaving ? "Saving…" : "Save changes"}
                                            </button>
                                            <button onClick={() => handleDelete(item.id)} disabled={deleting === item.id} className="px-3 py-1.5 text-red-400 text-xs rounded border border-red-800/40 disabled:opacity-40" style={{ background: "rgba(127,29,29,0.10)" }}>
                                                {deleting === item.id ? "…" : "Delete"}
                                            </button>
                                            <button onClick={() => setEditingId(null)} className="px-3 py-1.5 text-xs rounded border" style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}>
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Clear all */}
                    {hasItems && (
                        <div className="flex justify-end">
                            <button
                                onClick={handleClearAll}
                                disabled={clearSaving}
                                className="text-xs disabled:opacity-40 hover:text-red-400"
                                style={{ color: "var(--text-muted)" }}
                            >
                                {clearSaving ? "Clearing…" : "Clear all scenarios"}
                            </button>
                        </div>
                    )}

                    {/* Add form */}
                    {showForm ? (
                        <div className="rounded-lg p-4 space-y-3 border mt-2" style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)" }}>
                            <p className="text-xs font-bold text-amber-400 uppercase tracking-widest">New What-If Item</p>
                            {bulkResults && (
                                <p className="text-xs text-amber-600 border border-amber-200 rounded px-2 py-1 flex items-center gap-1.5" style={{ background: "rgba(217,119,6,0.05)" }}>
                                    <CheckCircle className="w-3.5 h-3.5" /> Added {bulkResults.count} items for &quot;{bulkResults.label}&quot;
                                </p>
                            )}
                            <input
                                ref={itemLabelRef}
                                type="text"
                                value={form.label}
                                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                                placeholder="e.g. Consulting fee, New client payment"
                                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all"
                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Type</label>
                                    <select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value as "in" | "out" }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                        <option value="out">Money Out</option>
                                        <option value="in">Money In</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Amount ($)</label>
                                    <input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" min={0} className="w-full border rounded-lg px-3 py-2 text-sm font-financial focus:outline-none focus:border-blue-500" style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-1">
                                    <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>From Week</label>
                                    <select value={form.fromWeekNumber} onChange={e => setForm(f => ({ ...f, fromWeekNumber: parseInt(e.target.value) }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                        {weeks.map(w => <option key={w.weekNumber} value={w.weekNumber}>Week {w.weekNumber} ({fmtDate(w.weekEnd)})</option>)}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>To Week</label>
                                    <select value={form.toWeekNumber} onChange={e => setForm(f => ({ ...f, toWeekNumber: parseInt(e.target.value) }))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500" style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                        {weeks.map(w => <option key={w.weekNumber} value={w.weekNumber} disabled={w.weekNumber < form.fromWeekNumber}>Week {w.weekNumber} ({fmtDate(w.weekEnd)})</option>)}
                                    </select>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={handleAdd} disabled={saving} className="flex-1 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-lg shadow-slate-900/10 transition-all active:scale-95 disabled:opacity-40">
                                    {saving ? "Simulating..." : <><Zap className="w-3.5 h-3.5 inline-block mr-1.5 flex-shrink-0" /> Inject into Forecast</>}
                                </button>
                                <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setFormError(null); }} className="px-4 py-2.5 text-xs font-bold rounded-xl border hover:bg-slate-50 transition-all" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)", background: "var(--bg-raised)" }}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button onClick={() => setShowForm(true)} className="w-full py-2 text-xs border border-dashed rounded-lg mt-1" style={{ color: "var(--text-muted)", borderColor: "var(--border-default)" }}>
                            + Add what-if item
                        </button>
                    )}

                    {hasItems && (
                        <p className="text-xs text-amber-600/70 text-center">
                            <Zap className="w-3.5 h-3.5 inline-block mr-1 mb-0.5 text-amber-500" /> Scenario mode — orange line shows projected impact.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
