// ui/CashflowGrid.tsx — 13-column grid + unified right sidebar (Backlog Dock ↔ Item Detail Drawer)
"use client";

import { useMemo, useState, useCallback, useEffect, useRef, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Package, Printer, Inbox, Search, X, CheckCircle, RotateCcw, ChevronDown, LayoutList, Flame } from "lucide-react";
import { ARAPCard, type GridItem, type DragPayload } from "./ARAPCard";
import { ItemDetailDrawer } from "./ItemDetailDrawer";
import { ExecutionPlanModal } from "./ExecutionPlanModal";

interface WeekMeta {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
}

interface RecurringWeek {
    weekNumber: number;
    total: number;
}

interface Props {
    weeks: WeekMeta[];
    invoices: GridItem[];
    bills: GridItem[];
    openingCash: number;
    weeklyRecurringOutflows: RecurringWeek[];
    weeklyRecurringInflows: RecurringWeek[];
    companyId: string;
    highlightWeek?: number | null;
    highlightId?: string | null;
    onRefresh: () => void;
    onClearHighlight?: () => void;
}

function fmt(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
    if (abs >= 1_000) return "$" + (n / 1_000).toFixed(1) + "k";
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0 });
}

function fmtDate(d: string): string {
    const dt = new Date(d);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

export function CashflowGrid({
    weeks, invoices, bills, openingCash,
    weeklyRecurringOutflows, weeklyRecurringInflows,
    companyId, highlightWeek, highlightId, onRefresh, onClearHighlight,
}: Props) {
    const router = useRouter();
    const [dropTargetWeek, setDropTargetWeek] = useState<number | null>(null);
    const [dropTargetDock, setDropTargetDock] = useState(false);
    const [dropping, setDropping] = useState(false);
    const [summaryView, setSummaryView] = useState(false);
    const [sortMode, setSortMode] = useState<"az" | "amount" | "aging">("aging");
    const [showPlan, setShowPlan] = useState(false);
    const [filterQuery, setFilterQuery] = useState("");
    const filterInputRef = useRef<HTMLInputElement>(null);
    const [showSortMenu, setShowSortMenu] = useState(false);
    const sortMenuRef = useRef<HTMLDivElement>(null);

    // Sidebar state: null = closed, "detail" = item detail
    const [sidebarMode, setSidebarMode] = useState<"detail" | null>(null);
    const [selectedItem, setSelectedItem] = useState<GridItem | null>(null);

    // Multi-selection state
    const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
    const lastSelectedIdRef = useRef<string | null>(null);

    // Batch-hint banner — shown until user dismisses (persisted in localStorage)
    const [showBatchHint, setShowBatchHint] = useState(false);
    useEffect(() => {
        const dismissed = localStorage.getItem("cfdo_batch_hint_dismissed");
        if (!dismissed) setShowBatchHint(true);
    }, []);
    const dismissBatchHint = () => {
        localStorage.setItem("cfdo_batch_hint_dismissed", "1");
        setShowBatchHint(false);
    };

    // ── Undo toast ──────────────────────────────────────────────────────────
    interface UndoState {
        label: string; // e.g. "8 bills moved to Backlog"
        items: { id: string; kind: "ar" | "ap"; prevOverrideDate: string | null; prevEffectiveDate: string | null }[];
    }
    const [undoState, setUndoState] = useState<UndoState | null>(null);
    const [toastProgress, setToastProgress] = useState(100); // 100→0 over 8s
    const toastTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const clearUndoToast = useCallback(() => {
        if (toastTimerRef.current) clearInterval(toastTimerRef.current);
        setUndoState(null);
        setToastProgress(100);
    }, []);

    const showUndoToast = useCallback((label: string, items: UndoState["items"]) => {
        if (toastTimerRef.current) clearInterval(toastTimerRef.current);
        setUndoState({ label, items });
        setToastProgress(100);
        const start = Date.now();
        const DURATION = 8000;
        toastTimerRef.current = setInterval(() => {
            const elapsed = Date.now() - start;
            const pct = Math.max(0, 100 - (elapsed / DURATION) * 100);
            setToastProgress(pct);
            if (pct === 0) {
                clearInterval(toastTimerRef.current!);
                setUndoState(null);
            }
        }, 50);
    }, []);

    const handleUndo = useCallback(async () => {
        if (!undoState) return;
        clearUndoToast();
        setDropping(true);
        try {
            await Promise.all(undoState.items.map(async ({ id, kind, prevOverrideDate, prevEffectiveDate }) => {
                const overrideType = kind === "ar" ? "set_expected_payment_date" : "set_bill_due_date";
                const targetType = kind === "ar" ? "invoice" : "bill";
                // Always delete the override we just created
                await fetch(`/api/overrides?targetId=${id}&type=${overrideType}`, { method: "DELETE" });
                // If item had a prior override, restore it
                if (prevOverrideDate) {
                    await fetch("/api/overrides", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ companyId, type: overrideType, targetType, targetId: id, effectiveDate: prevOverrideDate }),
                    });
                }
            }));
            onRefresh();
        } catch { /* ignore */ }
        finally { setDropping(false); }
    }, [undoState, clearUndoToast, companyId, onRefresh]);

    // Close sort dropdown on outside click
    useEffect(() => {
        if (!showSortMenu) return;
        const handler = (e: MouseEvent) => {
            if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
                setShowSortMenu(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [showSortMenu]);

    // Escape key: clear multi-selection (and close drawer)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSelectedItemIds(new Set());
                setSelectedItem(null);
                setSidebarMode(null);
            }
        };
        document.addEventListener("keydown", handler);
        return () => document.removeEventListener("keydown", handler);
    }, []);

    // Filter items by query (name, number, or amount)
    const filterItems = useCallback((items: GridItem[]): GridItem[] => {
        const q = filterQuery.trim().toLowerCase();
        if (!q) return items;
        const asNumber = parseFloat(q.replace(/[^0-9.]/g, ""));
        const isNumericSearch = !isNaN(asNumber) && q.replace(/[^0-9.]/g, "").length > 0;
        return items.filter(item => {
            if (isNumericSearch) {
                const lo = asNumber * 0.99;
                const hi = asNumber * 1.01;
                return item.amountOpen >= lo && item.amountOpen <= hi;
            }
            return (
                item.label.toLowerCase().includes(q) ||
                (item.invoiceNo ?? "").toLowerCase().includes(q) ||
                (item.billNo ?? "").toLowerCase().includes(q) ||
                (item.customerName ?? "").toLowerCase().includes(q) ||
                (item.vendorName ?? "").toLowerCase().includes(q)
            );
        });
    }, [filterQuery]);

    // Filtered item sets (applied before byWeek grouping)
    const filteredInvoices = useMemo(() => filterItems(invoices), [filterItems, invoices]);
    const filteredBills = useMemo(() => filterItems(bills), [filterItems, bills]);

    // Group items by week
    const byWeek = useMemo(() => {
        const map = new Map<number, { ar: GridItem[]; ap: GridItem[] }>();
        for (let w = 1; w <= 13; w++) map.set(w, { ar: [], ap: [] });
        for (const inv of filteredInvoices) {
            if (inv.effectiveWeek && map.has(inv.effectiveWeek)) map.get(inv.effectiveWeek)!.ar.push(inv);
        }
        for (const bill of filteredBills) {
            if (bill.effectiveWeek && map.has(bill.effectiveWeek)) map.get(bill.effectiveWeek)!.ap.push(bill);
        }
        return map;
    }, [filteredInvoices, filteredBills]);

    // Sort helper — applied at render time so sort changes are instant
    const sortItems = useCallback((items: GridItem[]): GridItem[] => {
        const copy = [...items];
        if (sortMode === "az") {
            copy.sort((a, b) => a.label.localeCompare(b.label));
        } else if (sortMode === "amount") {
            copy.sort((a, b) => b.amountOpen - a.amountOpen);
        } else if (sortMode === "aging") {
            // Most overdue first (highest positive daysPastDue first)
            copy.sort((a, b) => (b.daysPastDue ?? -999) - (a.daysPastDue ?? -999));
        }
        return copy;
    }, [sortMode]);

    // Running balance
    const weekBalances = useMemo(() => {
        const balances: { inflows: number; outflows: number; net: number; balance: number }[] = [];
        let running = openingCash;
        for (let w = 0; w < 13; w++) {
            const wn = w + 1;
            const items = byWeek.get(wn)!;
            const arTotal = items.ar.reduce((s, i) => s + i.amountOpen, 0);
            const apTotal = items.ap.reduce((s, i) => s + i.amountOpen, 0);
            const recOut = weeklyRecurringOutflows.find(r => r.weekNumber === wn)?.total ?? 0;
            const recIn = weeklyRecurringInflows.find(r => r.weekNumber === wn)?.total ?? 0;
            const inflows = arTotal + recIn;
            const outflows = apTotal + recOut;
            const net = inflows - outflows;
            running += net;
            balances.push({ inflows, outflows, net, balance: running });
        }
        return balances;
    }, [byWeek, openingCash, weeklyRecurringOutflows, weeklyRecurringInflows]);

    // Backlog items (use filtered sets so filter affects backlog too)
    const beyondAR = sortItems(filteredInvoices.filter(i => i.effectiveWeek === null));
    const beyondAP = sortItems(filteredBills.filter(b => b.effectiveWeek === null));
    const backlogCount = beyondAR.length + beyondAP.length;

    // Auto-select first item if needed? (optional, usually better to leave closed)

    // Summary stats (always use full unfiltered set for header tallies)
    const totalAR = invoices.reduce((s, i) => s + i.amountOpen, 0);
    const totalAP = bills.reduce((s, i) => s + i.amountOpen, 0);
    const overriddenCount = [...invoices, ...bills].filter(i => i.overrideDate).length;

    // Dollar totals for the current multi-selection
    const selectionTotals = useMemo(() => {
        if (selectedItemIds.size === 0) return null;
        const allItems = [...invoices, ...bills];
        let ar = 0, ap = 0;
        for (const id of selectedItemIds) {
            const it = allItems.find(i => i.id === id);
            if (!it) continue;
            if (it.kind === "ar") ar += it.amountOpen;
            else ap += it.amountOpen;
        }
        return { ar, ap };
    }, [selectedItemIds, invoices, bills]);

    // Card selection (single — opens detail drawer)
    const handleSelectCard = useCallback((item: GridItem) => {
        // Plain click clears bulk multi-selection but does NOT move the
        // Shift+Click anchor — otherwise an accidental plain click would
        // make the next Shift+Click select a huge unexpected range.
        setSelectedItemIds(new Set());
        if (selectedItem?.id === item.id && sidebarMode === "detail") {
            setSelectedItem(null);
            setSidebarMode(null);
        } else {
            setSelectedItem(item);
            setSidebarMode("detail");
        }
    }, [selectedItem, sidebarMode]);

    // Multi-select handler: Cmd/Ctrl+Click OR Shift+Click → toggles the individual item.
    // Range selection (Shift+Click selecting everything "between") is intentionally NOT
    // supported in a grid layout — items between two positions live in different off-screen
    // columns, making range selection confusing and error-prone.
    const handleMultiSelect = useCallback((item: GridItem, e: React.MouseEvent) => {
        void e; // modifier key already checked in ARAPCard before calling this
        setSelectedItemIds(prev => {
            const next = new Set(prev);
            if (next.has(item.id)) {
                next.delete(item.id);
            } else {
                next.add(item.id);
            }
            lastSelectedIdRef.current = item.id;
            return next;
        });
    }, []);

    // After a move, keep the drawer open but refresh the selected item data
    const handleMoved = useCallback(() => {
        onRefresh();
        // Drawer stays open — user can continue working
    }, [onRefresh]);

    // ── Drop handlers ──────────────────────────────────────────────────────
    const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>, weekNumber: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTargetWeek(weekNumber);
        setDropTargetDock(false);
    }, []);

    const handleDragLeave = useCallback(() => {
        setDropTargetWeek(null);
    }, []);

    const handleDrop = useCallback(async (e: DragEvent<HTMLDivElement>, weekNumber: number) => {
        e.preventDefault();
        setDropTargetWeek(null);
        const raw = e.dataTransfer.getData("application/cashflow-item");
        if (!raw) return;

        let payload: DragPayload;
        try { payload = JSON.parse(raw); } catch { return; }
        if (payload.sourceWeek === weekNumber) return;

        const wk = weeks.find(w => w.weekNumber === weekNumber);
        if (!wk) return;

        const weekStart = new Date(wk.weekStart);
        const friday = new Date(weekStart);
        friday.setDate(friday.getDate() + 4);
        const dateStr = friday.toISOString().slice(0, 10);
        const allItems = [...invoices, ...bills];

        const ids = payload.itemIds?.length ? payload.itemIds : [payload.itemId];

        // Capture before-state for undo
        const preState = ids.map(id => {
            const it = allItems.find(i => i.id === id);
            return { id, kind: (it?.kind ?? "ap") as "ar" | "ap", prevOverrideDate: it?.overrideDate ?? null, prevEffectiveDate: it?.effectiveDate ?? null };
        });

        setDropping(true);
        try {
            await Promise.all(ids.map(async (id) => {
                const thisItem = allItems.find(i => i.id === id);
                const overrideType = thisItem?.kind === "ar" ? "set_expected_payment_date" : "set_bill_due_date";
                const targetType = thisItem?.kind === "ar" ? "invoice" : "bill";
                if (thisItem?.overrideDate) {
                    await fetch(`/api/overrides?targetId=${id}&type=${overrideType}`, { method: "DELETE" });
                }
                await fetch("/api/overrides", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ companyId, type: overrideType, targetType, targetId: id, effectiveDate: dateStr }),
                });
            }));
            setSelectedItemIds(new Set());
            const noun = preState.every(p => p.kind === "ar") ? "invoice" : preState.every(p => p.kind === "ap") ? "bill" : "item";
            const plural = ids.length === 1 ? noun : `${noun}s`;
            showUndoToast(`${ids.length} ${plural} moved to Week ${weekNumber}`, preState);
            onRefresh();
        } catch { /* ignore */ }
        finally { setDropping(false); }
    }, [weeks, invoices, bills, companyId, onRefresh, showUndoToast]);

    const handleDropToDock = useCallback(async (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDropTargetDock(false);
        const raw = e.dataTransfer.getData("application/cashflow-item");
        if (!raw) return;

        let payload: DragPayload;
        try { payload = JSON.parse(raw); } catch { return; }

        const farFuture = new Date();
        farFuture.setDate(farFuture.getDate() + 14 * 7);
        const dateStr = farFuture.toISOString().slice(0, 10);
        const allItems = [...invoices, ...bills];

        const ids = payload.itemIds?.length ? payload.itemIds : [payload.itemId];

        // Capture before-state for undo
        const preState = ids.map(id => {
            const it = allItems.find(i => i.id === id);
            return { id, kind: (it?.kind ?? "ap") as "ar" | "ap", prevOverrideDate: it?.overrideDate ?? null, prevEffectiveDate: it?.effectiveDate ?? null };
        });

        setDropping(true);
        try {
            await Promise.all(ids.map(async (id) => {
                const thisItem = allItems.find(i => i.id === id);
                const overrideType = thisItem?.kind === "ar" ? "set_expected_payment_date" : "set_bill_due_date";
                const targetType = thisItem?.kind === "ar" ? "invoice" : "bill";
                if (thisItem?.overrideDate) {
                    await fetch(`/api/overrides?targetId=${id}&type=${overrideType}`, { method: "DELETE" });
                }
                await fetch("/api/overrides", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ companyId, type: overrideType, targetType, targetId: id, effectiveDate: dateStr }),
                });
            }));
            setSelectedItemIds(new Set());
            const noun = preState.every(p => p.kind === "ar") ? "invoice" : preState.every(p => p.kind === "ap") ? "bill" : "item";
            const plural = ids.length === 1 ? noun : `${noun}s`;
            showUndoToast(`${ids.length} ${plural} moved to Backlog`, preState);
            onRefresh();
        } catch { /* ignore */ }
        finally { setDropping(false); }
    }, [invoices, bills, companyId, onRefresh, showUndoToast]);

    // Zone color from running balance — light mode palette
    function zoneColor(balance: number): { bg: string; border: string; label: string } {
        if (balance <= 0)    return { bg: "rgba(220, 38, 38, 0.06)",  border: "rgba(220, 38, 38, 0.25)",  label: "DANGER" };
        if (balance < 10000) return { bg: "rgba(217, 119, 6, 0.06)",  border: "rgba(217, 119, 6, 0.20)",  label: "WARN" };
        return                      { bg: "var(--bg-surface)",        border: "var(--border-subtle)",   label: "" };
    }

    // Auto-select searched highlighted items — one-shot, consumed via ref so
    // closing the drawer doesn't re-open it and glow stops after first load.
    const highlightConsumedRef = useRef(false);
    useEffect(() => {
        if (!highlightId || highlightConsumedRef.current) return;
        const allItems = [...invoices, ...bills];
        const target = allItems.find(i => String(i.id) === String(highlightId));
        if (target) {
            highlightConsumedRef.current = true; // mark consumed immediately
            setSelectedItem(target);
            setSidebarMode("detail");
            // Keep the glow until the user clicks anywhere — then strip the URL param
            if (onClearHighlight) {
                const clear = () => {
                    onClearHighlight();
                    document.removeEventListener("mousedown", clear, true);
                };
                // Use capture so it fires before any inner click handlers (e.g. card toggle)
                document.addEventListener("mousedown", clear, { capture: true, once: true });
            }
        }
    // Only re-run if highlightId or the item lists change, NOT on selectedItem change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [highlightId, invoices, bills]);

    const sidebarOpen = sidebarMode !== null;

    return (
        <>
        <div className="space-y-4" onClick={(e) => {
            // Clear multi-selection when clicking on the grid background (not a card)
            if (e.target === e.currentTarget) setSelectedItemIds(new Set());
        }}>
            {/* ── Top bar ──────────────────────────────────────────────────── */}
            <div className="flex flex-wrap gap-4 items-center justify-between">
                <div className="flex flex-wrap gap-4 items-center">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>Opening Cash</span>
                        <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{fmt(openingCash)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#059669' }} />
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{invoices.length} AR</span>
                        <span className="text-xs font-semibold" style={{ color: '#059669' }}>+{fmt(totalAR)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#e11d48' }} />
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{bills.length} AP</span>
                        <span className="text-xs font-semibold" style={{ color: '#e11d48' }}>−{fmt(totalAP)}</span>
                    </div>
                    {overriddenCount > 0 && (
                        <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--color-primary)' }} />
                            <span className="text-xs" style={{ color: 'var(--color-primary)' }}>{overriddenCount} moved</span>
                        </div>
                    )}
                    {backlogCount > 0 && (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-violet-200 bg-violet-50">
                            <Package className="w-3 h-3 text-violet-600" />
                            <span className="text-[10px] font-bold text-violet-700">{backlogCount} in Backlog</span>
                        </div>
                    )}
                    {selectedItemIds.size > 0 && selectionTotals && (
                        <div className="flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-indigo-200 bg-indigo-50">
                            <span className="text-[10px] font-bold text-indigo-700">
                                {selectedItemIds.size} selected
                            </span>
                            {selectionTotals.ar > 0 && (
                                <span className="text-[10px] font-semibold" style={{ color: "#059669" }}>
                                    +{fmt(selectionTotals.ar)}
                                </span>
                            )}
                            {selectionTotals.ar > 0 && selectionTotals.ap > 0 && (
                                <span className="text-[10px] text-indigo-200">/</span>
                            )}
                            {selectionTotals.ap > 0 && (
                                <span className="text-[10px] font-semibold" style={{ color: "#e11d48" }}>
                                    −{fmt(selectionTotals.ap)}
                                </span>
                            )}
                            <button
                                onClick={() => setSelectedItemIds(new Set())}
                                className="text-indigo-400 hover:text-indigo-700 transition-colors ml-0.5"
                                title="Clear selection (Esc)"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    )}
                    {dropping && <span className="text-xs animate-pulse" style={{ color: 'var(--text-muted)' }}>Saving…</span>}
                    {filterQuery && (() => {
                        const matchCount = filteredInvoices.length + filteredBills.length;
                        const arTotal = filteredInvoices.reduce((s, i) => s + i.amountOpen, 0);
                        const apTotal = filteredBills.reduce((s, b) => s + b.amountOpen, 0);
                        return (
                            <div className="flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-indigo-200 bg-indigo-50">
                                <span className="text-[10px] font-bold text-indigo-600">
                                    {matchCount} match{matchCount !== 1 ? "es" : ""}
                                </span>
                                {arTotal > 0 && (
                                    <span className="text-[10px] font-semibold" style={{ color: "#059669" }}>
                                        +{fmt(arTotal)}
                                    </span>
                                )}
                                {arTotal > 0 && apTotal > 0 && (
                                    <span className="text-[10px] text-indigo-200">/</span>
                                )}
                                {apTotal > 0 && (
                                    <span className="text-[10px] font-semibold" style={{ color: "#e11d48" }}>
                                        −{fmt(apTotal)}
                                    </span>
                                )}
                            </div>
                        );
                    })()}
                </div>

                <div className="flex items-center gap-2">
                    {/* Inline filter search */}
                    <div className={`flex items-center gap-1.5 rounded-lg border px-2.5 transition-all duration-200 ${
                        filterQuery ? "border-indigo-300 bg-indigo-50/50 ring-1 ring-indigo-200" : "hover:border-slate-300"
                    }`} style={{ borderColor: filterQuery ? undefined : "var(--border-default)", background: filterQuery ? undefined : "var(--bg-raised)" }}>
                        <Search className="w-3 h-3 shrink-0" style={{ color: filterQuery ? "var(--color-primary)" : "var(--text-faint)" }} />
                        <input
                            ref={filterInputRef}
                            type="text"
                            placeholder="Filter items…"
                            value={filterQuery}
                            onChange={e => setFilterQuery(e.target.value)}
                            className="bg-transparent border-none outline-none text-xs py-1.5 w-32 focus:w-44 transition-all duration-200 placeholder:text-slate-400"
                            style={{ color: "var(--text-primary)" }}
                        />
                        {filterQuery && (
                            <button onClick={() => setFilterQuery("")} className="shrink-0 text-slate-400 hover:text-slate-700 transition-colors">
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>

                    {/* Sort dropdown */}
                    {(() => {
                        const SORT_LABELS = { az: "A–Z", amount: "$ Amt", aging: "Aging" } as const;
                        return (
                            <div ref={sortMenuRef} className="relative">
                                <button
                                    onClick={() => setShowSortMenu(v => !v)}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors"
                                    style={{
                                        background: "var(--bg-raised)",
                                        borderColor: "var(--border-default)",
                                        color: "var(--text-secondary)"
                                    }}
                                >
                                    <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>Sort:</span>
                                    {SORT_LABELS[sortMode]}
                                    <ChevronDown className={`w-3 h-3 transition-transform ${showSortMenu ? "rotate-180" : ""}`} />
                                </button>
                                {showSortMenu && (
                                    <div
                                        className="absolute right-0 top-full mt-1.5 w-36 rounded-xl border shadow-lg z-50 overflow-hidden"
                                        style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", boxShadow: "0 8px 24px rgba(0,0,0,0.10)" }}
                                    >
                                        {(["az", "amount", "aging"] as const).map((key, i) => (
                                            <button
                                                key={key}
                                                onClick={() => { setSortMode(key); setShowSortMenu(false); }}
                                                className={`w-full px-3 py-2 text-xs text-left font-medium transition-colors ${
                                                    i > 0 ? "border-t" : ""
                                                } ${sortMode === key ? "font-bold" : ""}`}
                                                style={{
                                                    color: sortMode === key ? "var(--color-primary)" : "var(--text-primary)",
                                                    background: sortMode === key ? "rgba(79,70,229,0.06)" : "transparent",
                                                    borderColor: "var(--border-subtle)",
                                                }}
                                            >
                                                {SORT_LABELS[key]}
                                                {sortMode === key && <span className="ml-1.5 text-[10px]">✓</span>}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    {/* View toggle — icon-only: Detail list vs Heat Map */}
                    <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--border-default)" }}>
                        <button
                            onClick={() => setSummaryView(false)}
                            title="Detail view — drag & drop"
                            className="px-2.5 py-1.5 flex items-center"
                            style={!summaryView
                                ? { background: "var(--bg-raised)", color: "var(--text-primary)" }
                                : { background: "transparent", color: "var(--text-faint)" }}
                        >
                            <LayoutList className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={() => setSummaryView(true)}
                            title="Heat Map — 13-week summary"
                            className="px-2.5 py-1.5 flex items-center border-l"
                            style={summaryView
                                ? { background: "var(--bg-raised)", color: "var(--text-primary)", borderColor: "var(--border-default)" }
                                : { background: "transparent", color: "var(--text-faint)", borderColor: "var(--border-default)" }}
                        >
                            <Flame className="w-3.5 h-3.5" />
                        </button>
                    </div>

                    {/* Execution Plan — primary CTA */}
                    <button
                        onClick={() => setShowPlan(true)}
                        title="Generate Week 1 Action Plan for clerks"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all hover:opacity-90 active:scale-95"
                        style={{
                            background: "var(--color-primary)",
                            color: "#fff",
                            boxShadow: "0 2px 8px rgba(79,70,229,0.35)"
                        }}
                    >
                        <Printer className="w-3.5 h-3.5" />
                        Execution Plan
                    </button>
                </div>
            </div>

            {/* ── HEAT-MAP SUMMARY VIEW ─────────────────────────────────────── */}
            {summaryView && (
                <div className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
                    <div className="px-4 py-2.5 border-b flex items-center gap-2" style={{ borderColor: "var(--border-subtle)" }}>
                        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>13-Week Heat Map</span>
                        <span className="text-[11px] px-1.5 py-0.5 rounded border" style={{ color: "var(--text-faint)", borderColor: "var(--border-subtle)" }}>switch to Detail to drag &amp; drop</span>
                    </div>
                    <div className="grid gap-px p-2" style={{ gridTemplateColumns: "repeat(14, 1fr)" }}>
                        {/* Backlog Summary Cell */}
                        <div className="flex flex-col items-center rounded-lg p-2 border text-center"
                            style={{ 
                                background: "var(--bg-raised)", 
                                borderColor: "var(--border-subtle)",
                                borderWidth: "1px",
                                opacity: backlogCount > 0 ? 1 : 0.5
                            }}
                        >
                            <span className="text-[10px] font-bold" style={{ color: "var(--text-muted)" }}>PARKED</span>
                            <Package className="w-3.5 h-3.5 my-1" style={{ color: backlogCount > 0 ? "var(--color-primary)" : "var(--text-faint)" }} />
                            <div className="mt-auto">
                                <p className="text-[10px] font-bold" style={{ color: backlogCount > 0 ? "var(--color-primary)" : "var(--text-muted)" }}>{backlogCount}</p>
                                <p className="text-[8px]" style={{ color: "var(--text-faint)" }}>items</p>
                            </div>
                        </div>

                        {weeks.map((wk, wi) => {
                            const bal = weekBalances[wi];
                            const zone = zoneColor(bal.balance);
                            const items = byWeek.get(wk.weekNumber)!;
                            return (
                                <div key={wk.weekNumber} className="flex flex-col items-center rounded-lg p-2 border text-center"
                                    style={{ background: zone.bg, borderColor: zone.border }}>
                                    <span className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>W{wk.weekNumber}</span>
                                    <span className="text-[8px] mt-0.5" style={{ color: "var(--text-faint)" }}>{new Date(wk.weekStart).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}</span>
                                    <span className={`text-xs font-bold font-financial mt-1.5 ${bal.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                        {bal.net >= 0 ? "+" : ""}{fmt(bal.net)}
                                    </span>
                                    <span className={`text-[8px] font-financial mt-0.5 ${bal.balance < 0 ? "text-red-500" : "var(--text-muted)"}`}>{fmt(bal.balance)}</span>
                                    <div className="flex gap-1 mt-1.5 flex-wrap justify-center">
                                        {items.ar.length > 0 && <span className="text-[7px] px-1 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}>{items.ar.length} AR</span>}
                                        {items.ap.length > 0 && <span className="text-[7px] px-1 rounded" style={{ background: "rgba(248,113,113,0.15)", color: "#f87171" }}>{items.ap.length} AP</span>}
                                    </div>
                                    {zone.label && (
                                        <span className={`text-[7px] font-bold mt-1 uppercase tracking-wider ${zone.label === "DANGER" ? "text-red-400" : "text-amber-400"}`}>
                                            {zone.label}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="px-4 py-2 border-t flex gap-4" style={{ borderColor: "var(--border-subtle)" }}>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border" style={{ background: "rgba(127,29,29,0.35)", borderColor: "rgba(248,113,113,0.40)" }} /><span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Danger (≤ $0)</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border" style={{ background: "rgba(120,53,15,0.25)", borderColor: "rgba(251,191,36,0.35)" }} /><span className="text-[11px]" style={{ color: "var(--text-muted)" }}>&lt; $10k</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded border" style={{ background: "transparent", borderColor: "var(--border-subtle)" }} /><span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Safe</span></div>
                    </div>
                </div>
            )}

            {/* ── DETAIL GRID + SIDEBAR ─────────────────────────────────────── */}
            {!summaryView && (
                <>
                {/* Batch-select hint banner */}
                {showBatchHint && (
                    <div
                        className="flex items-center gap-3 rounded-xl border px-4 py-2.5 mb-1"
                        style={{
                            background: "rgba(99,102,241,0.04)",
                            borderColor: "rgba(99,102,241,0.20)",
                        }}
                    >
                        <span style={{ fontSize: "1rem", lineHeight: 1 }}>💡</span>
                        <p className="flex-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                            <strong style={{ color: "var(--text-primary)" }}>Pro tip — Batch move:</strong>{" "}
                            Hold{" "}
                            <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold mx-0.5"
                                style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>⌘</kbd>
                            or{" "}
                            <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono font-bold mx-0.5"
                                style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}>Ctrl</kbd>
                            {" and click each bill or invoice you want — then drag any one and they all move together."}
                        </p>
                        <button
                            onClick={dismissBatchHint}
                            className="shrink-0 rounded-lg p-1 transition-colors hover:bg-indigo-100"
                            title="Got it — dismiss"
                            style={{ color: "var(--text-faint)" }}
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
                <div className="flex gap-3 items-start">

                    {/* Week columns — opacity dims slightly when detail panel is open (decorative only, never blocks interaction) */}
                    <div
                        className="flex-1 min-w-0 overflow-auto -mx-4 px-4 h-[calc(100vh-200px)] transition-opacity duration-200"
                        style={{ opacity: sidebarOpen ? 0.72 : 1 }}
                    >
                        <div className="flex gap-2.5 min-h-max pb-4 w-[max-content]" style={{ minWidth: `${14 * 190}px` }}>
                            
                            {/* ── Week 0: Backlog / Parking Lot ── */}
                            <div 
                                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTargetDock(true); setDropTargetWeek(null); }}
                                onDragLeave={() => setDropTargetDock(false)}
                                onDrop={handleDropToDock}
                                className={`flex flex-col rounded-xl border transition-all duration-150 shrink-0
                                    ${dropTargetDock ? "ring-2 ring-violet-400/30 scale-[1.02]" : ""}`}
                                style={{
                                    width: "220px",
                                    background: dropTargetDock 
                                        ? "rgba(139, 92, 246, 0.08)" 
                                        : "var(--bg-raised)",
                                    borderColor: dropTargetDock ? "rgba(139, 92, 246, 0.40)" : "var(--border-subtle)",
                                    borderStyle: "solid",
                                    borderWidth: "1px",
                                    opacity: backlogCount === 0 && !dropTargetDock ? 0.6 : 1,
                                    boxShadow: "inset 0 0 10px rgba(0,0,0,0.02)",
                                }}
                            >
                                {/* Backlog Header */}
                                <div className="sticky top-0 z-40 shadow-sm shadow-black/20 rounded-t-[11px] overflow-hidden -mx-[1px] -mt-[1px] border border-transparent">
                                    <div className="px-3 py-3 border-b transition-colors"
                                        style={dropTargetDock 
                                            ? { borderColor: "rgba(139, 92, 246, 0.40)", background: "#f5f3ff", boxShadow: "inset 0 3px 0 #8b5cf6" } 
                                            : { borderColor: "var(--border-subtle)", background: "var(--bg-surface)", boxShadow: "inset 0 3px 0 rgba(71, 85, 105, 0.4)" }
                                        }
                                    >
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest" style={{ color: dropTargetDock ? "var(--color-primary)" : "var(--text-muted)" }}>
                                                <Package className="w-3.5 h-3.5" />
                                                <span>{dropTargetDock ? "Release to Park" : "The Backlog"}</span>
                                            </div>
                                            {backlogCount > 0 && (
                                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" 
                                                    style={{ background: "var(--bg-raised)", color: "var(--text-primary)", border: "1px solid var(--border-subtle)" }}>
                                                    {backlogCount}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Backlog Cards */}
                                <div className="flex-1 px-2 py-3 space-y-1.5 min-h-[120px] overflow-y-auto custom-scrollbar">
                                    {backlogCount === 0 && !dropTargetDock && (
                                        <div className="py-12 text-center opacity-30 select-none">
                                            <Inbox className="w-8 h-8 mx-auto mb-2" />
                                            <p className="text-[10px] font-medium uppercase tracking-widest">Clear</p>
                                        </div>
                                    )}
                                    {dropTargetDock && (
                                        <div className="rounded-lg border-2 border-dashed border-violet-400/50 bg-violet-400/5 px-2 py-8 text-center mb-2 animate-pulse">
                                            <p className="text-[11px] text-violet-600 font-bold uppercase tracking-wider">Release to Park</p>
                                        </div>
                                    )}
                                    {beyondAR.length > 0 && (
                                        <div className="space-y-1.5">
                                            <p className="text-[9px] font-bold uppercase tracking-widest px-1 mb-1" style={{ color: "var(--text-faint)" }}>AR — {fmt(beyondAR.reduce((s,i)=>s+i.amountOpen,0))}</p>
                                            {beyondAR.map(inv => (
                                                <ARAPCard key={inv.id} item={inv} weeks={weeks} companyId={companyId} onMoved={handleMoved} onSelect={handleSelectCard} isSelected={selectedItem?.id === inv.id} isMultiSelected={selectedItemIds.has(inv.id)} selectedItemIds={selectedItemIds} onMultiSelect={handleMultiSelect} isBacklog highlightId={highlightId} />
                                            ))}
                                        </div>
                                    )}
                                    {beyondAP.length > 0 && (
                                        <div className="space-y-1.5 pt-2">
                                            <p className="text-[9px] font-bold uppercase tracking-widest px-1 mb-1" style={{ color: "var(--text-faint)" }}>AP — {fmt(beyondAP.reduce((s,i)=>s+i.amountOpen,0))}</p>
                                            {beyondAP.map(bill => (
                                                <ARAPCard key={bill.id} item={bill} weeks={weeks} companyId={companyId} onMoved={handleMoved} onSelect={handleSelectCard} isSelected={selectedItem?.id === bill.id} isMultiSelected={selectedItemIds.has(bill.id)} selectedItemIds={selectedItemIds} onMultiSelect={handleMultiSelect} isBacklog highlightId={highlightId} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── Weeks 1-13 ── */}
                            {weeks.map((wk, wi) => {
                                const items = byWeek.get(wk.weekNumber)!;
                                const bal = weekBalances[wi];
                                const recOut = weeklyRecurringOutflows.find(r => r.weekNumber === wk.weekNumber)?.total ?? 0;
                                const recIn = weeklyRecurringInflows.find(r => r.weekNumber === wk.weekNumber)?.total ?? 0;
                                const isDropTarget = dropTargetWeek === wk.weekNumber;
                                const isHighlighted = highlightWeek === wk.weekNumber;

                                return (
                                    <div
                                        key={wk.weekNumber}
                                        onDragOver={(e) => handleDragOver(e, wk.weekNumber)}
                                        onDragLeave={handleDragLeave}
                                        onDrop={(e) => handleDrop(e, wk.weekNumber)}
                                        className={`flex flex-col rounded-xl border transition-all duration-150 shrink-0
                                            ${isDropTarget ? "ring-2 ring-indigo-400/30 scale-[1.02]" : ""}
                                            ${isHighlighted ? "animate-highlight-flash z-10 relative" : ""}`}
                                        style={{
                                            width: "180px",
                                            background: isDropTarget ? "rgba(79,70,229,0.05)" : "var(--bg-surface)",
                                            borderColor: isDropTarget ? "rgba(79,70,229,0.40)" : "var(--border-subtle)",
                                        }}
                                    >
                                        {/* Sticky Header */}
                                        <div className="sticky top-0 z-40 shadow-sm shadow-black/20 rounded-t-[11px] overflow-hidden -mx-[1px] -mt-[1px] border border-transparent">
                                            <div className="px-3 py-2 border-b transition-colors"
                                                style={isDropTarget
                                                    ? { borderColor: "rgba(79,70,229,0.40)", background: "#f5f3ff", boxShadow: "inset 0 3px 0 var(--color-primary)" }
                                                    : {
                                                    borderColor: bal.balance <= 0 ? "rgba(220,38,38,0.20)" : bal.balance < 10000 ? "rgba(217,119,6,0.15)" : "var(--border-subtle)",
                                                    background: bal.balance <= 0 ? "#fef2f2" : bal.balance < 10000 ? "#fffbeb" : "var(--bg-surface)",
                                                    boxShadow: bal.balance <= 0 ? "inset 0 3px 0 #dc2626" : bal.balance < 10000 ? "inset 0 3px 0 #f59e0b" : "inset 0 3px 0 #94a3b8",
                                                }
                                                }
                                            >
                                                <div className="flex items-center justify-between">
                                                    <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>W{wk.weekNumber}</p>
                                                    {isDropTarget && <span className="text-xs animate-pulse" style={{ color: '#4f46e5' }}>Drop here</span>}
                                                </div>
                                                <p className="text-[10px]" style={{ color: 'var(--text-faint)' }}>{fmtDate(wk.weekStart)} – {fmtDate(wk.weekEnd)}</p>
                                            </div>

                                            <div className={`px-3 py-2 border-b space-y-0.5
                                                ${isDropTarget ? "border-indigo-200" : "border-[var(--border-subtle)]"}`}
                                                style={{ background: isDropTarget ? "#f5f3ff" : "var(--bg-raised)" }}
                                            >
                                                <div className="flex justify-between text-[10px]">
                                                    <span style={{ color: 'var(--text-muted)' }}>In</span>
                                                    <span style={{ color: '#059669' }}>+{fmt(bal.inflows)}</span>
                                                </div>
                                                <div className="flex justify-between text-[10px]">
                                                    <span style={{ color: 'var(--text-muted)' }}>Out</span>
                                                    <span style={{ color: '#e11d48' }}>−{fmt(bal.outflows)}</span>
                                                </div>

                                                <div className="flex justify-between text-[10px] font-semibold border-t pt-1 mt-1" style={{ borderColor: 'var(--border-subtle)' }}>
                                                    <span style={{ color: 'var(--text-muted)' }}>Net</span>
                                                    <span style={{ color: bal.net >= 0 ? '#059669' : '#dc2626' }}>
                                                        {bal.net >= 0 ? "+" : ""}{fmt(bal.net)}
                                                    </span>
                                                </div>
                                                <div className={`flex justify-between text-[10px] font-bold pt-1`}>
                                                    <span className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>Balance</span>
                                                    <span style={{ color: bal.balance < 0 ? '#dc2626' : 'var(--text-primary)' }}>{bal.balance < 0 ? "-" : ""}{fmt(Math.abs(bal.balance))}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Cards */}
                                        <div className="flex-1 px-2 py-2 space-y-1.5 min-h-[120px]">
                                             {sortItems(items.ar).map(inv => (
                                                <ARAPCard
                                                    key={inv.id}
                                                    item={inv}
                                                    weeks={weeks}
                                                    companyId={companyId}
                                                    onMoved={handleMoved}
                                                    onSelect={handleSelectCard}
                                                    isSelected={selectedItem?.id === inv.id}
                                                    isMultiSelected={selectedItemIds.has(inv.id)}
                                                    selectedItemIds={selectedItemIds}
                                                    onMultiSelect={handleMultiSelect}
                                                    highlightId={highlightId}
                                                />
                                            ))}
                                             {sortItems(items.ap).map(bill => (
                                                <ARAPCard
                                                    key={bill.id}
                                                    item={bill}
                                                    weeks={weeks}
                                                    companyId={companyId}
                                                    onMoved={handleMoved}
                                                    onSelect={handleSelectCard}
                                                    isSelected={selectedItem?.id === bill.id}
                                                    isMultiSelected={selectedItemIds.has(bill.id)}
                                                    selectedItemIds={selectedItemIds}
                                                    onMultiSelect={handleMultiSelect}
                                                    highlightId={highlightId}
                                                />
                                            ))}

                                            {/* Recurring summary */}
                                            {(recIn > 0 || recOut > 0) && (
                                                <div className="rounded-lg border px-2 py-1.5 text-[10px] space-y-0.5" style={{ background: 'var(--bg-raised)', borderColor: 'var(--border-subtle)' }}>
                                                    {recIn > 0 && (
                                                        <div className="flex justify-between">
                                                            <span style={{ color: 'var(--text-muted)' }}>Recurring in</span>
                                                            <span style={{ color: '#059669' }} className="font-medium">+{fmt(recIn)}</span>
                                                        </div>
                                                    )}
                                                    {recOut > 0 && (
                                                        <div className="flex justify-between">
                                                            <span style={{ color: 'var(--text-muted)' }}>Recurring out</span>
                                                            <span style={{ color: '#e11d48' }} className="font-medium">−{fmt(recOut)}</span>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {items.ar.length === 0 && items.ap.length === 0 && recIn === 0 && recOut === 0 && (
                                                <p className="text-[10px] text-center py-4" style={{ color: 'var(--text-faint)' }}>No items</p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── Right Sidebar (Detail ONLY) ──────────────────────────── */}
                    {sidebarMode === "detail" && selectedItem && (
                        <div
                            className="flex-shrink-0 flex flex-col rounded-2xl h-[calc(100vh-200px)] overflow-hidden transition-all duration-200"
                            style={{
                                width: "264px",
                                background: "#ffffff",
                                border: `2px solid ${selectedItem.kind === "ar" ? "rgba(34,197,94,0.40)" : "rgba(220,38,38,0.35)"}`,
                                boxShadow: "0 24px 64px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.10)",
                                backgroundImage: selectedItem.kind === "ar"
                                    ? "linear-gradient(to bottom, rgba(34,197,94,0.07) 0px, transparent 72px)"
                                    : "linear-gradient(to bottom, rgba(220,38,38,0.07) 0px, transparent 72px)",
                            }}
                        >
                            <ItemDetailDrawer
                                item={selectedItem}
                                weeks={weeks}
                                companyId={companyId}
                                onMoved={handleMoved}
                                onClose={() => {
                                    setSelectedItem(null);
                                    setSidebarMode(null);
                                }}
                            />
                        </div>
                    )}
                </div>
                </>
            )}
        </div>

        {/* Execution Plan Modal */}
        {showPlan && (
            <ExecutionPlanModal
                weeks={weeks}
                invoices={invoices}
                bills={bills}
                openingCash={openingCash}
                onClose={() => setShowPlan(false)}
            />
        )}

        {/* ── Undo Toast ─────────────────────────────────────────────────── */}
        {undoState && (
            <div
                className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col overflow-hidden rounded-xl shadow-2xl"
                style={{
                    minWidth: "340px",
                    maxWidth: "480px",
                    background: "#1e1e2e",
                    border: "1px solid rgba(255,255,255,0.10)",
                    boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
                }}
            >
                {/* Progress bar */}
                <div
                    className="h-[3px]"
                    style={{
                        width: `${toastProgress}%`,
                        background: "linear-gradient(90deg, #4ade80, #22c55e)",
                        transition: "width 50ms linear",
                    }}
                />
                <div className="flex items-center gap-3 px-4 py-3">
                    <CheckCircle className="w-4 h-4 shrink-0" style={{ color: "#4ade80" }} />
                    <p className="flex-1 text-sm font-medium" style={{ color: "#f1f5f9" }}>
                        {undoState.label}
                    </p>
                    <button
                        onClick={handleUndo}
                        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors"
                        style={{ background: "rgba(99,102,241,0.25)", color: "#a5b4fc" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(99,102,241,0.45)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "rgba(99,102,241,0.25)")}
                    >
                        <RotateCcw className="w-3 h-3" />
                        Undo
                    </button>
                    <button
                        onClick={clearUndoToast}
                        className="rounded-lg p-1 transition-colors"
                        style={{ color: "rgba(255,255,255,0.35)" }}
                        onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.75)")}
                        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.35)")}
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        )}
        </>
    );
}
