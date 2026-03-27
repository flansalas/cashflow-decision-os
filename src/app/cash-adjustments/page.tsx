// app/cash-adjustments/page.tsx — Cash Adjustments (Other Cash Flows) dedicated screen
"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
    ArrowLeft, Plus, Pencil, Trash2, X, AlertTriangle, RefreshCw,
    TrendingUp, TrendingDown, BarChart3, ChevronDown, ChevronRight,
    DollarSign, ArrowUpRight, ArrowDownLeft, Check, FolderPlus, Layers, CheckCircle
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────

interface CashFlowCategory {
    id: string;
    companyId: string;
    name: string;
    direction: "inflow" | "outflow";
    sortOrder: number;
    entries: CashFlowEntry[];
}

interface CashFlowEntry {
    id: string;
    companyId: string;
    categoryId: string;
    label: string;
    amount: number;
    weekNumber: number;
    note: string | null;
    category?: CashFlowCategory;
}

interface ForecastWeek {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    endCashExpected: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0 });
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Add Category Form ──────────────────────────────────────────────────

function AddCategoryForm({ direction, companyId, onCreated }: {
    direction: "inflow" | "outflow"; companyId: string; onCreated: (id: string) => void;
}) {
    const [name, setName] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (!name.trim()) { setError("Name is required"); return; }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/cash-categories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, name: name.trim(), direction }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error ?? "Failed"); setSaving(false); return; }
            setName("");
            onCreated(data.id);
        } catch { setError("Network error"); } finally { setSaving(false); }
    };

    return (
        <div className="flex items-center gap-2 mt-3">
            <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder={`New ${direction === "inflow" ? "cash-in" : "cash-out"} category…`}
                onKeyDown={e => e.key === "Enter" && handleSave()}
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 shadow-sm"
                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
            <button onClick={handleSave} disabled={saving || !name.trim()}
                className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg disabled:opacity-40 shadow-sm transition-all flex items-center gap-1.5">
                {saving ? "…" : <><Plus className="w-3.5 h-3.5" /> Add</>}
            </button>
            {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
    );
}

// ── Category Card ──────────────────────────────────────────────────────

function CategoryCard({ category, companyId, weeks, isHighlighted, highlightWeek, isNew, onChanged }: {
    category: CashFlowCategory; companyId: string; weeks: ForecastWeek[];
    isHighlighted: boolean; highlightWeek: number | null; isNew: boolean; onChanged: () => void;
}) {
    const [expanded, setExpanded] = useState(isHighlighted || isNew);
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState(category.name);
    const [addingEntry, setAddingEntry] = useState(isNew);
    const [justAdded, setJustAdded] = useState(false);
    const [newEntry, setNewEntry] = useState({ label: "", amount: "", weekNumber: "1", note: "" });
    const [saving, setSaving] = useState(false);
    const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
    const [editEntry, setEditEntry] = useState({ label: "", amount: "", weekNumber: "", note: "" });
    const cardRef = useRef<HTMLDivElement>(null);
    const labelRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isHighlighted && cardRef.current) {
            cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
            setExpanded(true);
        }
    }, [isHighlighted]);

    useEffect(() => {
        if (isNew) {
            setExpanded(true);
            setAddingEntry(true);
            setTimeout(() => labelRef.current?.focus(), 100);
        }
    }, [isNew]);

    useEffect(() => {
        setEditName(category.name);
    }, [category.name]);

    const totalAmount = category.entries.reduce((s, e) => s + e.amount, 0);

    const handleRename = async () => {
        if (!editName.trim()) return;
        setSaving(true);
        try {
            await fetch(`/api/cash-categories/${category.id}`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: editName.trim() }),
            });
            setEditing(false);
            onChanged();
        } finally { setSaving(false); }
    };

    const handleDeleteCategory = async () => {
        if (!confirm(`Delete category "${category.name}" and all its entries?`)) return;
        await fetch(`/api/cash-categories/${category.id}`, { method: "DELETE" });
        onChanged();
    };

    const handleAddEntry = async () => {
        const amount = parseFloat(newEntry.amount);
        const weekNum = parseInt(newEntry.weekNumber);
        if (!newEntry.label.trim() || isNaN(amount) || amount <= 0 || isNaN(weekNum) || weekNum < 1 || weekNum > 13) return;
        setSaving(true);
        try {
            await fetch("/api/cash-entries", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, categoryId: category.id, label: newEntry.label.trim(), amount, weekNumber: weekNum, note: newEntry.note.trim() || null }),
            });
            // Reset form but DO NOT setAddingEntry(false)
            setNewEntry({ label: "", amount: "", weekNumber: newEntry.weekNumber, note: "" }); 
            onChanged();
            // Show a brief success toast/indicator
            setJustAdded(true);
            setTimeout(() => setJustAdded(false), 2000);
        } finally { setSaving(false); }
    };

    const handleUpdateEntry = async (id: string) => {
        const amount = parseFloat(editEntry.amount);
        const weekNum = parseInt(editEntry.weekNumber);
        if (!editEntry.label.trim() || isNaN(amount) || amount <= 0 || isNaN(weekNum)) return;
        setSaving(true);
        try {
            await fetch(`/api/cash-entries/${id}`, {
                method: "PATCH", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ label: editEntry.label.trim(), amount, weekNumber: weekNum, note: editEntry.note.trim() || null }),
            });
            setEditingEntryId(null);
            onChanged();
        } finally { setSaving(false); }
    };

    const handleDeleteEntry = async (id: string) => {
        if (!confirm("Delete this entry?")) return;
        await fetch(`/api/cash-entries/${id}`, { method: "DELETE" });
        onChanged();
    };

    // Group entries by week
    const entriesByWeek = new Map<number, CashFlowEntry[]>();
    for (const e of category.entries) {
        if (!entriesByWeek.has(e.weekNumber)) entriesByWeek.set(e.weekNumber, []);
        entriesByWeek.get(e.weekNumber)!.push(e);
    }

    const isInflow = category.direction === "inflow";

    return (
        <div ref={cardRef}
            className={`rounded-xl border overflow-hidden transition-all duration-500 ${isHighlighted ? "animate-highlight-flash z-10 relative" : ""}`}
            style={{
                background: "var(--bg-surface)", 
                borderColor: isHighlighted ? "rgba(79,70,229,0.5)" : "var(--border-subtle)",
                boxShadow: isHighlighted ? "0 0 0 3px rgba(79,70,229,0.15)" : undefined,
            }}>
            {/* Category Header */}
            <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => setExpanded(e => !e)} className="flex-1 flex items-center gap-3 text-left">
                    {expanded
                        ? <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "var(--text-muted)" }} />
                        : <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "var(--text-muted)" }} />
                    }
                    <div className="flex items-center gap-2 min-w-0">
                        {isInflow
                            ? <ArrowDownLeft className="w-4 h-4 text-emerald-500 shrink-0" />
                            : <ArrowUpRight className="w-4 h-4 text-red-500 shrink-0" />
                        }
                        {editing ? (
                            <div className="flex items-center gap-2">
                                <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                                    onKeyDown={e => e.key === "Enter" && handleRename()}
                                    className="border rounded-lg px-2 py-1 text-sm focus:outline-none focus:border-indigo-500"
                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                                    onClick={e => e.stopPropagation()} />
                                <button onClick={(e) => { e.stopPropagation(); handleRename(); }} disabled={saving}
                                    className="text-xs px-2 py-1 bg-indigo-600 text-white rounded font-semibold disabled:opacity-40">Save</button>
                                <button onClick={(e) => { e.stopPropagation(); setEditing(false); setEditName(category.name); }}
                                    className="text-xs px-2 py-1 rounded border" style={{ color: "var(--text-muted)", borderColor: "var(--border-default)" }}>Cancel</button>
                            </div>
                        ) : (
                            <span className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{category.name}</span>
                        )}
                    </div>
                </button>
                <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-sm font-bold ${isInflow ? "text-emerald-600" : "text-red-600"}`}>
                        {isInflow ? "+" : "-"}{fmt(totalAmount)}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full border" style={{ color: "var(--text-muted)", borderColor: "var(--border-default)" }}>
                        {category.entries.length}
                    </span>
                    {!editing && (
                        <>
                            <button onClick={() => { setEditing(true); setEditName(category.name); }}
                                className="p-1 rounded hover:bg-black/5 transition-colors" title="Rename">
                                <Pencil className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
                            </button>
                            <button onClick={handleDeleteCategory}
                                className="p-1 rounded hover:bg-red-50 transition-colors" title="Delete category">
                                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {expanded && (
                <div className="border-t px-4 py-3 space-y-2" style={{ borderColor: "var(--border-subtle)" }}>
                    {/* 13-week mini grid */}
                    <div className="flex gap-1 mb-3">
                        {Array.from({ length: 13 }, (_, i) => i + 1).map(wn => {
                            const weekEntries = entriesByWeek.get(wn) || [];
                            const weekTotal = weekEntries.reduce((s, e) => s + e.amount, 0);
                            const isHLWeek = highlightWeek === wn;
                            return (
                                <div key={wn} className={`flex-1 text-center rounded-lg border py-1.5 transition-all ${isHLWeek ? "animate-highlight-flash z-10 relative" : ""}`}
                                    style={{
                                        borderColor: isHLWeek ? "rgba(79,70,229,0.5)" : weekTotal > 0 ? (isInflow ? "rgba(5,150,105,0.2)" : "rgba(220,38,38,0.15)") : "var(--border-subtle)",
                                        background: weekTotal > 0 ? (isInflow ? "rgba(5,150,105,0.05)" : "rgba(220,38,38,0.03)") : "var(--bg-raised)",
                                    }}>
                                    <span className="text-[9px] font-bold block" style={{ color: "var(--text-muted)" }}>W{wn}</span>
                                    {weekTotal > 0 && (
                                        <span className={`text-[10px] font-bold ${isInflow ? "text-emerald-600" : "text-red-600"}`}>
                                            {fmt(weekTotal)}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Entries list */}
                    {category.entries.length === 0 ? (
                        <p className="text-xs py-2 text-center" style={{ color: "var(--text-muted)" }}>No entries yet. Add one below.</p>
                    ) : (
                        category.entries
                            .sort((a, b) => a.weekNumber - b.weekNumber)
                            .map(entry => (
                                <div key={entry.id} className="rounded-lg border px-3 py-2" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                                    {editingEntryId === entry.id ? (
                                        <div className="space-y-2">
                                            <div className="grid grid-cols-3 gap-2">
                                                <input type="text" value={editEntry.label} onChange={e => setEditEntry(s => ({ ...s, label: e.target.value }))}
                                                    placeholder="Label" className="col-span-2 border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
                                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                                                <input type="number" value={editEntry.amount} onChange={e => setEditEntry(s => ({ ...s, amount: e.target.value }))}
                                                    placeholder="Amount" className="border rounded-lg px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-indigo-500"
                                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                                            </div>
                                            <div className="grid grid-cols-3 gap-2">
                                                <select value={editEntry.weekNumber} onChange={e => setEditEntry(s => ({ ...s, weekNumber: e.target.value }))}
                                                    className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
                                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                                    <option value="">Week…</option>
                                                    {Array.from({ length: 13 }, (_, i) => i + 1).map(wn => <option key={wn} value={wn}>Week {wn}</option>)}
                                                </select>
                                                <input type="text" value={editEntry.note} onChange={e => setEditEntry(s => ({ ...s, note: e.target.value }))}
                                                    placeholder="Note (optional)" className="col-span-2 border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
                                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={() => handleUpdateEntry(entry.id)} disabled={saving}
                                                    className="px-3 py-1 bg-indigo-600 text-white text-xs rounded font-semibold disabled:opacity-40">
                                                    {saving ? "…" : "Save"}
                                                </button>
                                                <button onClick={() => setEditingEntryId(null)}
                                                    className="px-3 py-1 text-xs rounded border" style={{ color: "var(--text-muted)", borderColor: "var(--border-default)" }}>Cancel</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}>W{entry.weekNumber}</span>
                                                <span className="text-sm truncate" style={{ color: "var(--text-primary)" }}>{entry.label}</span>
                                                {entry.note && <span className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>— {entry.note}</span>}
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className={`text-sm font-bold ${isInflow ? "text-emerald-600" : "text-red-600"}`}>{fmt(entry.amount)}</span>
                                                <button onClick={() => { setEditingEntryId(entry.id); setEditEntry({ label: entry.label, amount: String(entry.amount), weekNumber: String(entry.weekNumber), note: entry.note || "" }); }}
                                                    className="p-1 rounded hover:bg-black/5 transition-colors"><Pencil className="w-3 h-3" style={{ color: "var(--text-muted)" }} /></button>
                                                <button onClick={() => handleDeleteEntry(entry.id)}
                                                    className="p-1 rounded hover:bg-red-50 transition-colors"><Trash2 className="w-3 h-3 text-red-400" /></button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))
                    )}

                    {/* Add Entry */}
                    {addingEntry ? (
                        <div className="rounded-lg border p-3 space-y-2" style={{ background: "var(--bg-raised)", borderColor: "rgba(79,70,229,0.15)" }}>
                            <div className="grid grid-cols-3 gap-2">
                                <input type="text" value={newEntry.label} onChange={e => setNewEntry(s => ({ ...s, label: e.target.value }))}
                                    ref={labelRef}
                                    placeholder="Label (e.g. New Forklift)" className="col-span-2 border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                                <input type="number" value={newEntry.amount} onChange={e => setNewEntry(s => ({ ...s, amount: e.target.value }))}
                                    placeholder="Amount ($)" min={0} className="border rounded-lg px-2 py-1.5 text-xs font-bold focus:outline-none focus:border-indigo-500"
                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                <select value={newEntry.weekNumber} onChange={e => setNewEntry(s => ({ ...s, weekNumber: e.target.value }))}
                                    className="border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>
                                    <option value="">Week…</option>
                                    {Array.from({ length: 13 }, (_, i) => i + 1).map(wn => <option key={wn} value={wn}>Week {wn}</option>)}
                                </select>
                                <input type="text" value={newEntry.note} onChange={e => setNewEntry(s => ({ ...s, note: e.target.value }))}
                                    placeholder="Note (optional)" className="col-span-2 border rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-500"
                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                            </div>
                            <div className="flex items-center justify-between">
                                <div className="flex gap-2">
                                    <button onClick={handleAddEntry} disabled={saving}
                                        className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg disabled:opacity-40 shadow-sm flex items-center gap-2 transition-all active:scale-95">
                                        {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                                        Save Entry
                                    </button>
                                    <button onClick={() => { setAddingEntry(false); setNewEntry({ label: "", amount: "", weekNumber: "", note: "" }); }}
                                        className="px-3 py-1.5 text-xs font-bold rounded-lg border bg-white hover:bg-slate-50 transition-colors"
                                        style={{ color: "var(--text-secondary)", borderColor: "var(--border-default)" }}>
                                        Done
                                    </button>
                                </div>
                                {justAdded && (
                                    <span className="text-[10px] font-bold text-emerald-600 animate-bounce flex items-center gap-1">
                                        <CheckCircle className="w-3 h-3" /> Entry Added!
                                    </span>
                                )}
                            </div>
                        </div>
                    ) : (
                        <button onClick={() => setAddingEntry(true)}
                            className="w-full py-2.5 text-xs border border-dashed rounded-lg transition-all hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/50 flex items-center justify-center gap-2 group"
                            style={{ color: "var(--text-muted)", borderColor: "var(--border-default)" }}>
                            <Plus className="w-3.5 h-3.5 group-hover:scale-110 transition-transform" /> 
                            Add another entry to this category
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Net Impact Bar ─────────────────────────────────────────────────────

function SurvivalRunway({ weeks, bufferMin }: { weeks: ForecastWeek[], bufferMin: number }) {
    if (weeks.length === 0) return null;

    const weeklyData = weeks.map(w => ({
        weekNumber: w.weekNumber,
        weekStart: w.weekStart,
        endCash: w.endCashExpected,
    }));

    const maxCash = Math.max(...weeklyData.map(d => d.endCash), bufferMin * 2, 1);
    const minCash = Math.min(...weeklyData.map(d => d.endCash), 0);
    const range = maxCash - minCash;

    return (
        <div className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
            <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--border-subtle)" }}>
                <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                        13-Week Survival Runway
                    </span>
                    <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded font-black uppercase tracking-widest border border-amber-200 bg-amber-50 text-amber-600">
                        Buffer: {fmt(bufferMin)}
                    </span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-red-500 shadow-sm" />
                        <span className="text-[10px] font-bold uppercase tracking-tight" style={{ color: "var(--text-muted)" }}>Danger</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-amber-400 shadow-sm" />
                        <span className="text-[10px] font-bold uppercase tracking-tight" style={{ color: "var(--text-muted)" }}>Below Buffer</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm" />
                        <span className="text-[10px] font-bold uppercase tracking-tight" style={{ color: "var(--text-muted)" }}>Healthy</span>
                    </div>
                </div>
            </div>
            <div className="px-5 pt-12 pb-5 flex gap-2 items-end relative" style={{ minHeight: "180px" }}>
                {/* Risk Zone Backgrounds */}
                <div className="absolute left-0 right-0 z-0 pointer-events-none" 
                    style={{ 
                        bottom: '35px', 
                        height: `${Math.max(((Math.min(bufferMin, maxCash) - minCash) / range) * 90, 0)}%`,
                        background: 'linear-gradient(to top, rgba(239, 68, 68, 0.04) 0%, rgba(245, 158, 11, 0.05) 100%)',
                        borderTop: '1px solid rgba(245, 158, 11, 0.08)' 
                    }} />

                {/* Buffer Line */}
                <div className="absolute left-0 right-0 border-t border-dashed z-20 pointer-events-none" 
                    style={{ 
                        bottom: `${((bufferMin - minCash) / range) * 90 + 35}px`, 
                        borderColor: "rgba(245, 158, 11, 0.4)" 
                    }} />

                {weeklyData.map(d => {
                    const heightPct = Math.max(((d.endCash - minCash) / range) * 90, 2);
                    const isNegative = d.endCash < 0;
                    const isBelowBuffer = d.endCash < bufferMin;
                    
                    let barColor = "rgba(16, 185, 129, 0.6)"; // Healthy
                    if (isNegative) barColor = "rgba(239, 68, 68, 0.7)"; // Danger
                    else if (isBelowBuffer) barColor = "rgba(245, 158, 11, 0.6)"; // Amber

                    return (
                        <div key={d.weekNumber} className="flex-1 flex flex-col items-center group relative h-full justify-end" title={`W${d.weekNumber}: ${fmt(d.endCash)}`}>
                            {/* Amount Label */}
                            <div className="absolute -top-6 text-center w-full transform -translate-y-1 transition-transform group-hover:-translate-y-2" style={{ bottom: `${heightPct + 35}px` }}>
                                <span className={`text-[9px] font-black whitespace-nowrap px-1 rounded ${isNegative ? "text-red-600 bg-red-50/50" : isBelowBuffer ? "text-amber-600 bg-amber-50/50" : "text-emerald-700 bg-emerald-50/50"}`}>
                                    {fmt(d.endCash)}
                                </span>
                            </div>
                            
                            {/* Bar */}
                            <div className="w-full rounded-t-md transition-all group-hover:brightness-110 shadow-sm" 
                                style={{ height: `${heightPct}%`, background: barColor, minHeight: "4px" }} />
                                
                            {/* Week Label */}
                            <div className="mt-2 text-center pb-1">
                                <span className="text-[10px] font-black uppercase tracking-tighter" style={{ color: "var(--text-muted)" }}>W{d.weekNumber}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Main Page ───────────────────────────────────────────────────────────

function CashAdjustmentsContent() {
    const searchParams = useSearchParams();
    const directionParam = searchParams.get("direction") as "in" | "out" | null;
    const highlightWeek = searchParams.get("highlightWeek") ? Number(searchParams.get("highlightWeek")) : null;
    const highlightCategory = searchParams.get("highlightCategory");
    const companyId = searchParams.get("companyId") ?? (typeof window !== "undefined" ? localStorage.getItem("cfdo_company_id") : null);

    const [categories, setCategories] = useState<CashFlowCategory[]>([]);
    const [weeks, setWeeks] = useState<ForecastWeek[]>([]);
    const [bufferMin, setBufferMin] = useState(10000);
    const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeDirection, setActiveDirection] = useState<"inflow" | "outflow">(
        directionParam === "in" ? "inflow" : directionParam === "out" ? "outflow" : "outflow"
    );

    const fetchData = useCallback(async () => {
        if (!companyId) return;
        setLoading(true);
        try {
            const [catRes, dashRes] = await Promise.all([
                fetch(`/api/cash-categories?companyId=${companyId}`),
                fetch(`/api/dashboard?companyId=${companyId}`),
            ]);
            const cats = await catRes.json();
            const dash = await dashRes.json();
            if (Array.isArray(cats)) setCategories(cats);
            if (dash.forecast?.weeks) setWeeks(dash.forecast.weeks);
            if (dash.assumptions?.bufferMin) setBufferMin(dash.assumptions.bufferMin);
            setError(null);
        } catch { setError("Failed to load data"); }
        finally { setLoading(false); }
    }, [companyId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="text-center space-y-4">
                    <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full mx-auto" />
                    <p className="text-sm tracking-wide" style={{ color: "var(--text-muted)" }}>Loading cash adjustments…</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="border rounded-xl p-8 max-w-md text-center" style={{ background: '#fff5f5', borderColor: 'rgba(220,38,38,0.25)' }}>
                    <p style={{ color: '#dc2626' }} className="text-base font-medium mb-3 flex items-center justify-center gap-2">
                        <AlertTriangle className="w-5 h-5" /> {error}
                    </p>
                    <a href="/dashboard" style={{ color: 'var(--color-primary)' }} className="hover:underline text-sm flex items-center justify-center gap-1">
                        <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
                    </a>
                </div>
            </div>
        );
    }

    const inflowCategories = categories.filter(c => c.direction === "inflow");
    const outflowCategories = categories.filter(c => c.direction === "outflow");
    const activeCategories = activeDirection === "inflow" ? inflowCategories : outflowCategories;

    return (
        <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
            {/* Header */}
            <header className="border-b sticky top-0 z-50 backdrop-blur-md" style={{ background: "rgba(255,255,255,0.92)", borderColor: "var(--border-subtle)", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <a href="/dashboard" className="text-xs font-medium flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                            <ArrowLeft className="w-3 h-3" /> Dashboard
                        </a>
                        <span style={{ color: "var(--border-default)" }}>/</span>
                        <span style={{ color: "var(--color-primary)" }} className="font-bold text-sm flex items-center gap-1.5">
                            <Layers className="w-4 h-4" /> Cash Adjustments
                        </span>
                    </div>
                    <button onClick={fetchData} className="p-1.5 rounded-lg border text-sm" title="Refresh"
                        style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-muted)" }}>
                        <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-5 py-6 space-y-5">
                {/* Survival Runway */}
                <SurvivalRunway weeks={weeks} bufferMin={bufferMin} />

                {/* Direction Toggle */}
                <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--border-default)" }}>
                    <button onClick={() => setActiveDirection("inflow")}
                        className="flex-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide flex items-center justify-center gap-1.5 transition-colors"
                        style={activeDirection === "inflow"
                            ? { background: "rgba(5,150,105,0.10)", color: "#059669" }
                            : { background: "var(--bg-raised)", color: "var(--text-muted)" }}>
                        <ArrowDownLeft className="w-3.5 h-3.5" /> Cash In ({inflowCategories.length})
                    </button>
                    <button onClick={() => setActiveDirection("outflow")}
                        className="flex-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide flex items-center justify-center gap-1.5 border-l transition-colors"
                        style={activeDirection === "outflow"
                            ? { background: "rgba(99,102,241,0.10)", color: "#4f46e5", borderColor: "var(--border-default)" }
                            : { background: "var(--bg-raised)", color: "var(--text-muted)", borderColor: "var(--border-default)" }}>
                        <ArrowUpRight className="w-3.5 h-3.5" /> Cash Out ({outflowCategories.length})
                    </button>
                </div>

                {/* Categories List */}
                <div className="space-y-3">
                    {activeCategories.length === 0 ? (
                        <div className="rounded-xl border py-8 text-center" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                            <FolderPlus className="w-8 h-8 mx-auto mb-2" style={{ color: "var(--text-muted)", opacity: 0.4 }} />
                            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                                No {activeDirection === "inflow" ? "cash-in" : "cash-out"} categories yet.
                            </p>
                            <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                                Create one below to start tracking {activeDirection === "inflow" ? "additional income" : "extra expenses"}.
                            </p>
                        </div>
                    ) : (
                        activeCategories.map(cat => (
                            <CategoryCard
                                key={cat.id}
                                category={cat}
                                companyId={companyId ?? ""}
                                weeks={weeks}
                                isHighlighted={highlightCategory === cat.id}
                                highlightWeek={highlightCategory === cat.id ? highlightWeek : null}
                                isNew={lastCreatedId === cat.id}
                                onChanged={() => { setLastCreatedId(null); fetchData(); }}
                            />
                        ))
                    )}
 
                    <AddCategoryForm
                        direction={activeDirection}
                        companyId={companyId ?? ""}
                        onCreated={(id) => {
                            setLastCreatedId(id);
                            fetchData();
                        }}
                    />
                </div>
            </main>
        </div>
    );
}

export default function CashAdjustmentsPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full" />
            </div>
        }>
            <CashAdjustmentsContent />
        </Suspense>
    );
}
