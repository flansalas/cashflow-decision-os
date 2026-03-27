// ui/ARAPCard.tsx — Draggable invoice/bill card for the cashflow grid
// Clicking selects the card (opens Detail Drawer); no inline expansion.
"use client";

import { useState, useRef, useEffect, type DragEvent } from "react";

export interface GridItem {
    id: string;
    kind: "ar" | "ap";
    label: string;
    amountOpen: number;
    effectiveWeek: number | null;
    overrideDate: string | null;
    risk: string;
    confidence?: string;
    // Detail drawer fields
    customerName?: string;
    vendorName?: string;
    invoiceNo?: string;
    billNo?: string;
    invoiceDate?: string | null;
    billDate?: string | null;
    dueDate?: string | null;
    daysPastDue?: number | null;
    originalAmount?: number;
    moveCount?: number;
    expectedDate?: string | null;
    effectiveDate?: string | null;
}

/** Payload stored in dataTransfer during drag */
export interface DragPayload {
    itemId: string;
    kind: "ar" | "ap";
    sourceWeek: number | null;
}

interface Props {
    item: GridItem;
    weeks: { weekNumber: number; weekStart: string; weekEnd: string }[];
    companyId: string;
    onMoved: () => void;
    onSelect?: (item: GridItem) => void;
    isSelected?: boolean;
    isBacklog?: boolean;
    highlightId?: string | null;
}

function fmt(n: number): string {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0 });
}

const riskColors: Record<string, string> = {
    low:      "var(--color-risk-low)",
    med:      "var(--color-risk-med)",
    high:     "var(--color-risk-high)",
    normal:   "var(--color-risk-normal)",
    critical: "var(--color-risk-critical)",
};

function AgingBadge({ days }: { days: number | null | undefined }) {
    if (days == null) return null;
    const abs = Math.abs(days);
    const isLate = days > 0;
    const isEarly = days < -1;

    if (!isLate && !isEarly) return null;

    let label = "";
    let color = "";
    let bg = "";

    if (isLate) {
        label = `${abs}d late`;
        if (days > 60)      { color = "var(--color-danger)"; bg = "var(--bg-raised)"; }
        else if (days > 14) { color = "var(--color-caution)"; bg = "var(--bg-raised)"; }
        else                { color = "var(--text-muted)"; bg = "var(--bg-raised)"; }
    } else {
        label = `${abs}d early`;
        color = "var(--text-muted)";
        bg = "var(--bg-raised)";
    }

    return (
        <span
            className="text-micro font-medium px-1.5 py-0.5 rounded shrink-0"
            style={{ color, background: bg }}
        >
            {label}
        </span>
    );
}

export function ARAPCard({ item, weeks, companyId, onMoved, onSelect, isSelected, isBacklog, highlightId }: Props) {
    const [dragging, setDragging] = useState(false);
    // Guard: after a real drag, the browser fires a stray onClick — skip it
    const didDragRef = useRef(false);

    const [dismissed, setDismissed] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);

    const isAR = item.kind === "ar";
    const isOverridden = !!item.overrideDate;

    const isHighlighted = !!highlightId && String(highlightId) === String(item.id) && !dismissed;

    useEffect(() => {
        if (isHighlighted && cardRef.current) {
            // Give a tiny delay for layout to stabilize
            setTimeout(() => {
                cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
            }, 100);
        }
    }, [isHighlighted]);

    // ── Drag handlers ─────────────────────────────────────────────────────
    const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
        didDragRef.current = false; // reset on new drag start
        const payload: DragPayload = {
            itemId: item.id,
            kind: item.kind,
            sourceWeek: item.effectiveWeek,
        };
        e.dataTransfer.setData("application/cashflow-item", JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "move";
        setDragging(true);
    };

    const handleDragEnd = (e: DragEvent<HTMLDivElement>) => {
        // Mark that a drag occurred so the stray onClick can be suppressed
        if (e.dataTransfer.dropEffect !== "none") {
            didDragRef.current = true;
            // Clear after enough time for onClick to fire and check it
            setTimeout(() => { didDragRef.current = false; }, 200);
        }
        setDragging(false);
    };

    const handleClick = () => {
        if (didDragRef.current) return; // suppress post-drag onClick
        setDismissed(true);
        onSelect?.(item);
    };

    return (
        <div
            ref={cardRef}
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onClick={handleClick}
            className={`rounded-xl border cursor-pointer select-none ${
                isHighlighted ? "" : "overflow-hidden"
            } ${dragging ? "opacity-40 scale-95" : "transition-all hover:shadow-md hover:scale-[1.02]"} ${isHighlighted ? "persistent-focus-glow" : ""}`}
            style={{
                zIndex: isHighlighted ? 100 : undefined,
                background: "var(--bg-surface)",
                borderColor: isSelected
                    ? "var(--slate-900)"
                    : "var(--border-subtle)",
                boxShadow: isSelected
                    ? "0 0 0 1px var(--slate-900), 0 4px 6px -1px rgb(0 0 0 / 0.1)"
                    : "0 1px 2px 0 rgb(0 0 0 / 0.05)",
                borderLeftWidth: "3px",
                borderLeftColor: riskColors[item.risk] ?? "var(--text-muted)",
                ...(isBacklog && {
                    opacity: 0.8,
                    filter: "grayscale(0.2)"
                })
            }}
        >
            <div className="px-3 py-2.5">
                {/* Row 1: drag handle + label */}
                <div className="flex items-start gap-2">
                    <span className="text-xs shrink-0 mt-0.5" style={{ color: "var(--text-faint)" }}>&#8943;</span>
                    <span className="line-clamp-2 leading-tight flex-1 font-medium text-xs" style={{ color: "var(--text-secondary)" }} title={item.label}>
                        {item.label}
                    </span>
                </div>

                {/* Row 2: amount + badges */}
                <div className="flex items-center justify-between mt-1.5 gap-2 flex-wrap">
                    <span className={`font-bold font-financial text-sm ${isAR ? "text-emerald-700" : "text-indigo-600"}`}>
                        {isAR ? "+" : "−"}{fmt(item.amountOpen)}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <AgingBadge days={item.daysPastDue} />
                        {isOverridden && !item.daysPastDue && (
                            <span
                                className="text-micro border px-1.5 py-0.5 rounded"
                                style={{ color: "var(--color-primary)", borderColor: "rgba(79,70,229,0.20)", background: "rgba(79,70,229,0.06)" }}
                            >
                                moved
                            </span>
                        )}
                        {(item.moveCount ?? 0) > 1 && !item.daysPastDue && (
                            <span
                                className="text-micro px-1.5 py-0.5 rounded"
                                style={{ color: "#6d28d9", background: "rgba(109,40,217,0.08)" }}
                            >
                                ×{item.moveCount}
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
