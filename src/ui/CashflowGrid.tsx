// ui/CashflowGrid.tsx — 13-column grid + unified right sidebar (Backlog Dock ↔ Item Detail Drawer)
"use client";

import { useMemo, useState, useCallback, useEffect, type DragEvent } from "react";
import { Package, Printer, Inbox } from "lucide-react";
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
    companyId, highlightWeek, highlightId, onRefresh,
}: Props) {
    const [dropTargetWeek, setDropTargetWeek] = useState<number | null>(null);
    const [dropTargetDock, setDropTargetDock] = useState(false);
    const [dropping, setDropping] = useState(false);
    const [summaryView, setSummaryView] = useState(false);
    const [sortMode, setSortMode] = useState<"az" | "amount" | "aging">("az");
    const [showPlan, setShowPlan] = useState(false);

    // Sidebar state: null = closed, "detail" = item detail
    const [sidebarMode, setSidebarMode] = useState<"detail" | null>(null);
    const [selectedItem, setSelectedItem] = useState<GridItem | null>(null);

    // Group items by week
    const byWeek = useMemo(() => {
        const map = new Map<number, { ar: GridItem[]; ap: GridItem[] }>();
        for (let w = 1; w <= 13; w++) map.set(w, { ar: [], ap: [] });
        for (const inv of invoices) {
            if (inv.effectiveWeek && map.has(inv.effectiveWeek)) map.get(inv.effectiveWeek)!.ar.push(inv);
        }
        for (const bill of bills) {
            if (bill.effectiveWeek && map.has(bill.effectiveWeek)) map.get(bill.effectiveWeek)!.ap.push(bill);
        }
        return map;
    }, [invoices, bills]);

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

    // Backlog items
    const beyondAR = sortItems(invoices.filter(i => i.effectiveWeek === null));
    const beyondAP = sortItems(bills.filter(b => b.effectiveWeek === null));
    const backlogCount = beyondAR.length + beyondAP.length;

    // Auto-select first item if needed? (optional, usually better to leave closed)

    // Summary stats
    const totalAR = invoices.reduce((s, i) => s + i.amountOpen, 0);
    const totalAP = bills.reduce((s, i) => s + i.amountOpen, 0);
    const overriddenCount = [...invoices, ...bills].filter(i => i.overrideDate).length;

    // Card selection
    const handleSelectCard = useCallback((item: GridItem) => {
        if (selectedItem?.id === item.id && sidebarMode === "detail") {
            // Deselect
            setSelectedItem(null);
            setSidebarMode(null);
        } else {
            setSelectedItem(item);
            setSidebarMode("detail");
        }
    }, [selectedItem, sidebarMode]);

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
        const overrideType = payload.kind === "ar" ? "set_expected_payment_date" : "set_bill_due_date";
        const targetType = payload.kind === "ar" ? "invoice" : "bill";

        setDropping(true);
        try {
            const allItems = [...invoices, ...bills];
            const item = allItems.find(i => i.id === payload.itemId);
            if (item?.overrideDate) {
                await fetch(`/api/overrides?targetId=${payload.itemId}&type=${overrideType}`, { method: "DELETE" });
            }
            await fetch("/api/overrides", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, type: overrideType, targetType, targetId: payload.itemId, effectiveDate: dateStr }),
            });
            onRefresh();
        } catch { /* ignore */ }
        finally { setDropping(false); }
    }, [weeks, invoices, bills, companyId, onRefresh]);

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
        const overrideType = payload.kind === "ar" ? "set_expected_payment_date" : "set_bill_due_date";
        const targetType = payload.kind === "ar" ? "invoice" : "bill";

        setDropping(true);
        try {
            const allItems = [...invoices, ...bills];
            const item = allItems.find(i => i.id === payload.itemId);
            if (item?.overrideDate) {
                await fetch(`/api/overrides?targetId=${payload.itemId}&type=${overrideType}`, { method: "DELETE" });
            }
            await fetch("/api/overrides", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, type: overrideType, targetType, targetId: payload.itemId, effectiveDate: dateStr }),
            });
            onRefresh();
        } catch { /* ignore */ }
        finally { setDropping(false); }
    }, [invoices, bills, companyId, onRefresh]);

    // Zone color from running balance — light mode palette
    function zoneColor(balance: number): { bg: string; border: string; label: string } {
        if (balance <= 0)    return { bg: "rgba(220, 38, 38, 0.06)",  border: "rgba(220, 38, 38, 0.25)",  label: "DANGER" };
        if (balance < 10000) return { bg: "rgba(217, 119, 6, 0.06)",  border: "rgba(217, 119, 6, 0.20)",  label: "WARN" };
        return                      { bg: "var(--bg-surface)",        border: "var(--border-subtle)",   label: "" };
    }

    const sidebarOpen = sidebarMode !== null;

    return (
        <>
        <div className="space-y-4">
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
                    {dropping && <span className="text-xs animate-pulse" style={{ color: 'var(--text-muted)' }}>Saving…</span>}
                </div>

                <div className="flex items-center gap-2">
                    {/* View mode toggle */}
                    <div className="flex rounded-lg overflow-hidden border text-xs font-semibold uppercase tracking-wide" style={{ borderColor: "var(--border-default)" }}>
                        <button onClick={() => setSummaryView(false)} className="px-3 py-1.5"
                            style={!summaryView ? { background: "var(--bg-raised)", color: "var(--text-primary)" } : { background: "transparent", color: "var(--text-muted)" }}>
                            Detail
                        </button>
                        <button onClick={() => setSummaryView(true)} className="px-3 py-1.5 border-l"
                            style={summaryView
                                ? { background: "var(--bg-raised)", color: "var(--text-primary)", borderColor: "var(--border-default)" }
                                : { background: "transparent", color: "var(--text-muted)", borderColor: "var(--border-default)" }}>
                            Heat Map
                        </button>
                    </div>

                    {/* Sort toggle */}
                    <div className="flex rounded-lg overflow-hidden border text-xs font-semibold tracking-wide" style={{ borderColor: "var(--border-default)" }}>
                        {([
                            { key: "az",     label: "A–Z",    title: "Alphabetical" },
                            { key: "amount", label: "$ Amt",  title: "Highest amount first" },
                            { key: "aging",  label: "Aging",  title: "Most overdue first" },
                        ] as const).map(({ key, label, title }, i) => (
                            <button
                                key={key}
                                title={title}
                                onClick={() => setSortMode(key)}
                                className={`px-2.5 py-1.5 ${i > 0 ? "border-l" : ""}`}
                                style={sortMode === key
                                    ? { background: "rgba(59,130,246,0.08)", color: "var(--color-primary)", borderColor: "var(--border-default)" }
                                    : { background: "transparent", color: "var(--text-muted)", borderColor: "var(--border-default)" }
                                }
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    {/* Execution Plan print button */}
                    <button
                        onClick={() => setShowPlan(true)}
                        title="Generate Week 1 Action Plan for clerks"
                        className="btn-outline"
                    >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Execution Plan</span>
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
                <div className="flex gap-3 items-start">

                    {/* Week columns */}
                    <div className="flex-1 min-w-0 overflow-auto -mx-4 px-4 h-[calc(100vh-200px)]">
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
                                                <ARAPCard key={inv.id} item={inv} weeks={weeks} companyId={companyId} onMoved={handleMoved} onSelect={handleSelectCard} isSelected={selectedItem?.id === inv.id} isBacklog highlightId={highlightId} />
                                            ))}
                                        </div>
                                    )}
                                    {beyondAP.length > 0 && (
                                        <div className="space-y-1.5 pt-2">
                                            <p className="text-[9px] font-bold uppercase tracking-widest px-1 mb-1" style={{ color: "var(--text-faint)" }}>AP — {fmt(beyondAP.reduce((s,i)=>s+i.amountOpen,0))}</p>
                                            {beyondAP.map(bill => (
                                                <ARAPCard key={bill.id} item={bill} weeks={weeks} companyId={companyId} onMoved={handleMoved} onSelect={handleSelectCard} isSelected={selectedItem?.id === bill.id} isBacklog highlightId={highlightId} />
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
                            className="flex-shrink-0 flex flex-col rounded-xl border h-[calc(100vh-200px)] overflow-hidden transition-all duration-200 shadow-xl"
                            style={{
                                width: "240px",
                                background: "var(--bg-surface)",
                                borderColor: "var(--border-strong)",
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
        </>
    );
}
