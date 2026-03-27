// ui/ExecutionPlanModal.tsx — Printable "Week 1 Action Plan" for AR/AP clerks
// Sections: Approved to Pay | Collection Targets | Hold List
"use client";

import { useMemo, useState } from "react";
import { Printer, CheckCircle, Phone, Lock } from "lucide-react";
import type { GridItem } from "./ARAPCard";

interface WeekMeta {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
}

interface Props {
    weeks: WeekMeta[];
    invoices: GridItem[];
    bills: GridItem[];
    openingCash: number;
    onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function agingLabel(days: number | null | undefined): { text: string; urgent: boolean } {
    if (days == null) return { text: "Unknown", urgent: false };
    if (days <= 0)    return { text: days === 0 ? "Due today" : `Due in ${Math.abs(days)}d`, urgent: false };
    if (days <= 14)   return { text: `${days}d past due — send reminder`, urgent: false };
    if (days <= 30)   return { text: `${days}d past due — escalate`, urgent: true };
    if (days <= 60)   return { text: `${days}d past due — urgent call required`, urgent: true };
    return               { text: `${days}d past due — CRITICAL, call today`, urgent: true };
}

// ── Sub-components ─────────────────────────────────────────────────────────
function SectionHeader({ emoji, title, subtitle, color }: {
    emoji: React.ReactNode; title: string; subtitle: string; color: string;
}) {
    return (
        <div className="flex items-start gap-3 mb-4 pb-3 print-border-bottom" style={{ borderBottom: "2px solid " + color }}>
            <div style={{ padding: "4px 0" }}>{emoji}</div>
            <div>
                <h2 style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a", margin: 0 }}>{title}</h2>
                <p style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>{subtitle}</p>
            </div>
        </div>
    );
}

function EmptySection({ message }: { message: string }) {
    return (
        <p style={{ fontSize: "12px", color: "#94a3b8", fontStyle: "italic", padding: "8px 0" }}>{message}</p>
    );
}

interface RowProps {
    item: GridItem;
    isHold?: boolean;
    originalDue?: string | null;
}

function ItemRow({ item, isHold, originalDue }: RowProps) {
    const isAR = item.kind === "ar";
    const name = isAR ? (item.customerName ?? item.label) : (item.vendorName ?? item.label);
    const ref  = isAR ? item.invoiceNo : item.billNo;
    const aging = agingLabel(item.daysPastDue);

    return (
        <tr style={{ borderBottom: "1px solid #e2e8f0", pageBreakInside: "avoid" }}>
            {/* Checkbox */}
            <td style={{ width: "28px", padding: "10px 8px 10px 0", verticalAlign: "top" }}>
                {!isHold && (
                    <div style={{
                        width: "16px", height: "16px", border: "1.5px solid #94a3b8",
                        borderRadius: "3px", display: "inline-block", flexShrink: 0
                    }} />
                )}
                {isHold && (
                    <span className="text-gray-400 flex items-center justify-center pt-1"><Lock className="w-3.5 h-3.5" /></span>
                )}
            </td>

            {/* Party + Ref */}
            <td style={{ padding: "10px 12px 10px 0", verticalAlign: "top", minWidth: "160px" }}>
                <div style={{ fontWeight: 600, fontSize: "12px", color: "#0f172a" }}>{name}</div>
                <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "2px" }}>{ref}</div>
            </td>

            {/* Amount */}
            <td style={{ padding: "10px 12px 10px 0", verticalAlign: "top", textAlign: "right", whiteSpace: "nowrap" }}>
                <span style={{
                    fontWeight: 700, fontSize: "13px",
                    color: isHold ? "#94a3b8" : isAR ? "#059669" : "#dc2626",
                    textDecoration: isHold ? "line-through" : "none"
                }}>
                    {isAR ? "+" : "−"}{fmt(item.amountOpen)}
                </span>
            </td>

            {/* Status / Instructions */}
            <td style={{ padding: "10px 0", verticalAlign: "top", minWidth: "200px" }}>
                {isHold ? (
                    <div>
                        <span style={{
                            display: "inline-block", fontSize: "10px", fontWeight: 600, padding: "2px 7px",
                            borderRadius: "99px", background: "#fef3c7", color: "#92400e",
                            border: "1px solid #fcd34d"
                        }}>
                            ⚠ DO NOT PAY/COLLECT YET
                        </span>
                        {originalDue && (
                            <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "4px" }}>
                                Originally due {fmtDate(originalDue)} — management deferred
                            </div>
                        )}
                    </div>
                ) : aging.urgent ? (
                    <span style={{
                        display: "inline-block", fontSize: "10px", fontWeight: 600, padding: "2px 7px",
                        borderRadius: "99px", background: "#fee2e2", color: "#991b1b",
                        border: "1px solid #fca5a5"
                    }}>
                        {aging.text}
                    </span>
                ) : (
                    <span style={{ fontSize: "11px", color: "#64748b" }}>{aging.text}</span>
                )}
            </td>

            {/* Notes — blank line for clerk */}
            <td style={{ padding: "10px 0", verticalAlign: "top", width: "130px" }}>
                {!isHold && (
                    <div style={{ borderBottom: "1px solid #cbd5e1", height: "14px", marginTop: "4px" }} />
                )}
            </td>
        </tr>
    );
}

// ── Main Component ─────────────────────────────────────────────────────────
export function ExecutionPlanModal({ weeks, invoices, bills, openingCash, onClose }: Props) {
    const [activeTab, setActiveTab] = useState<"all" | "ar" | "ap">("all");

    const week1 = weeks[0];
    const printDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

    // ── Data derivation ────────────────────────────────────────────────────
    const {
        approvedToPay,
        collectionTargets,
        holdItems,
        totalCollect,
        totalPay,
    } = useMemo(() => {
        // Active Week 1 items
        const collectionTargets = invoices
            .filter(i => i.effectiveWeek === 1)
            .sort((a, b) => (b.daysPastDue ?? 0) - (a.daysPastDue ?? 0)); // most urgent first

        const approvedToPay = bills
            .filter(b => b.effectiveWeek === 1)
            .sort((a, b) => b.amountOpen - a.amountOpen); // largest first

        // Hold list: items whose ORIGINAL due date falls in Week 1's window
        // but management has moved out of Week 1 (override set, effectiveWeek !== 1)
        const w1Start = new Date(week1.weekStart);
        const w1End   = new Date(week1.weekEnd);

        const holdItems: { item: GridItem; originalDue: string | null }[] = [];
        for (const item of [...invoices, ...bills]) {
            if (!item.overrideDate) continue;
            if (item.effectiveWeek === 1) continue; // it's IN week 1, not deferred
            const originalDue = item.dueDate;
            if (!originalDue) continue;
            const due = new Date(originalDue);
            if (due >= w1Start && due <= w1End) {
                holdItems.push({ item, originalDue });
            }
        }
        holdItems.sort((a, b) => b.item.amountOpen - a.item.amountOpen);

        const totalCollect = collectionTargets.reduce((s, i) => s + i.amountOpen, 0);
        const totalPay     = approvedToPay.reduce((s, i) => s + i.amountOpen, 0);

        return { approvedToPay, collectionTargets, holdItems, totalCollect, totalPay };
    }, [invoices, bills, week1]);

    const showAR = activeTab === "all" || activeTab === "ar";
    const showAP = activeTab === "all" || activeTab === "ap";

    return (
        <>
            {/* Print CSS injected into head */}
            <style>{`
                @media print {
                    body > *:not(#execution-plan-overlay) { display: none !important; }
                    #execution-plan-overlay { position: static !important; background: white !important; }
                    #execution-plan-modal-header { display: none !important; }
                    #execution-plan-tabs { display: none !important; }
                    .no-print { display: none !important; }
                    @page { margin: 1.2cm 1.4cm; }
                }
            `}</style>

            {/* Overlay */}
            <div
                id="execution-plan-overlay"
                className="fixed inset-0 z-50 flex flex-col"
                style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            >
                {/* Modal chrome (hidden on print) */}
                <div id="execution-plan-modal-header"
                    className="no-print flex-shrink-0 flex items-center justify-between px-6 py-3"
                    style={{ background: "#0f172a", borderBottom: "1px solid rgba(255,255,255,0.08)" }}
                >
                    <div className="flex items-center gap-3">
                        <Printer className="w-6 h-6 text-gray-400" />
                        <div>
                            <p className="text-sm font-bold text-white">Week 1 Action Plan</p>
                            <p className="text-xs" style={{ color: "#64748b" }}>Clerk execution handoff · {week1 ? `${fmtDate(week1.weekStart)} – ${fmtDate(week1.weekEnd)}` : ""}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Tab filter */}
                        <div id="execution-plan-tabs" className="flex rounded-lg overflow-hidden border text-[11px] font-semibold" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
                            {(["all", "ar", "ap"] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className="px-3 py-1.5 border-l first:border-l-0"
                                    style={{
                                        borderColor: "rgba(255,255,255,0.10)",
                                        background: activeTab === tab ? "rgba(255,255,255,0.12)" : "transparent",
                                        color: activeTab === tab ? "#fff" : "#64748b",
                                    }}
                                >
                                    {tab === "all" ? "Full Plan" : tab === "ar" ? "AR Only" : "AP Only"}
                                </button>
                            ))}
                        </div>

                        <button
                            onClick={() => window.print()}
                            className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold"
                            style={{ background: "#2563eb", color: "#fff" }}
                        >
                            <Printer className="w-4 h-4" /> Print / Save PDF
                        </button>

                        <button
                            onClick={onClose}
                            className="text-gray-400 hover:text-white text-lg leading-none px-2"
                        >
                            ×
                        </button>
                    </div>
                </div>

                {/* Printable body */}
                <div
                    className="flex-1 overflow-auto"
                    style={{ background: "#f8fafc" }}
                >
                    <div
                        style={{
                            maxWidth: "860px",
                            margin: "0 auto",
                            padding: "36px 40px 60px",
                            background: "#ffffff",
                            minHeight: "100%",
                            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                        }}
                    >
                        {/* ── Document Header ─────────────────────────────────────── */}
                        <div style={{ borderBottom: "3px solid #0f172a", paddingBottom: "16px", marginBottom: "24px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                                <div>
                                    <h1 style={{ fontSize: "20px", fontWeight: 800, color: "#0f172a", margin: 0 }}>
                                        Cash Execution Plan
                                    </h1>
                                    <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                                        Week of {week1 ? `${fmtDate(week1.weekStart)} — ${fmtDate(week1.weekEnd)}` : "—"}
                                    </p>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                    <p style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Generated</p>
                                    <p style={{ fontSize: "11px", color: "#475569", fontWeight: 500 }}>{printDate}</p>
                                    <p style={{ fontSize: "10px", color: "#dc2626", fontWeight: 700, marginTop: "4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Confidential · Internal Use Only</p>
                                </div>
                            </div>

                            {/* Summary band */}
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(4, 1fr)",
                                gap: "12px",
                                marginTop: "20px",
                            }}>
                                {[
                                    { label: "Opening Cash",  value: fmt(openingCash),              color: "#0f172a" },
                                    { label: "Target Collect", value: `+${fmt(totalCollect)}`,       color: "#059669" },
                                    { label: "Approved to Pay",value: `−${fmt(totalPay)}`,           color: "#dc2626" },
                                    { label: "Net Impact",     value: `${totalCollect - totalPay >= 0 ? "+" : ""}${fmt(totalCollect - totalPay)}`, color: totalCollect - totalPay >= 0 ? "#059669" : "#dc2626" },
                                ].map(({ label, value, color }) => (
                                    <div key={label} style={{
                                        background: "#f1f5f9",
                                        borderRadius: "8px",
                                        padding: "10px 14px",
                                        border: "1px solid #e2e8f0",
                                    }}>
                                        <p style={{ fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600, margin: 0 }}>{label}</p>
                                        <p style={{ fontSize: "16px", fontWeight: 800, color, margin: "4px 0 0" }}>{value}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* ── PART 1: APPROVED TO PAY (AP) ────────────────────────── */}
                        {showAP && (
                            <div style={{ marginBottom: "40px", pageBreakInside: "avoid" }}>
                                <SectionHeader
                                    emoji={<CheckCircle className="w-6 h-6 text-red-600" />}
                                    title="Approved to Pay"
                                    subtitle={`${approvedToPay.length} vendor payment${approvedToPay.length !== 1 ? "s" : ""} authorized for this week · Total: ${fmt(totalPay)}`}
                                    color="#dc2626"
                                />

                                {approvedToPay.length === 0 ? (
                                    <EmptySection message="No bills are scheduled for this week." />
                                ) : (
                                    <>
                                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                                            <thead>
                                                <tr style={{ borderBottom: "1px solid #cbd5e1" }}>
                                                    <th style={{ width: "28px" }} />
                                                    <th style={{ textAlign: "left", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Vendor / Bill #</th>
                                                    <th style={{ textAlign: "right", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Amount</th>
                                                    <th style={{ textAlign: "left", padding: "4px 0 8px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Priority / Status</th>
                                                    <th style={{ textAlign: "left", padding: "4px 0 8px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600, width: "130px" }}>Notes</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {approvedToPay.map(item => (
                                                    <ItemRow key={item.id} item={item} />
                                                ))}
                                            </tbody>
                                        </table>
                                        <div style={{
                                            marginTop: "12px", padding: "8px 12px",
                                            background: "#fef2f2", border: "1px solid #fecaca",
                                            borderRadius: "6px", fontSize: "10px", color: "#7f1d1d"
                                        }}>
                                            ⚠ <strong>Do not release payments outside this list</strong> without management authorization.
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* ── PART 2: COLLECTION TARGETS (AR) ─────────────────────── */}
                        {showAR && (
                            <div style={{ marginBottom: "40px", pageBreakInside: "avoid" }}>
                                <SectionHeader
                                    emoji={<Phone className="w-6 h-6 text-emerald-600" />}
                                    title="Collection Targets"
                                    subtitle={`${collectionTargets.length} invoice${collectionTargets.length !== 1 ? "s" : ""} to follow up on this week · Target: ${fmt(totalCollect)}`}
                                    color="#059669"
                                />

                                {collectionTargets.length === 0 ? (
                                    <EmptySection message="No invoices are expected this week." />
                                ) : (
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                                        <thead>
                                            <tr style={{ borderBottom: "1px solid #cbd5e1" }}>
                                                <th style={{ width: "28px" }} />
                                                <th style={{ textAlign: "left", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Customer / Invoice #</th>
                                                <th style={{ textAlign: "right", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Amount</th>
                                                <th style={{ textAlign: "left", padding: "4px 0 8px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Urgency / Tone</th>
                                                <th style={{ textAlign: "left", padding: "4px 0 8px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600, width: "130px" }}>Outcome</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {collectionTargets.map(item => (
                                                <ItemRow key={item.id} item={item} />
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        )}

                        {/* ── PART 3: HOLD LIST ────────────────────────────────────── */}
                        {showAP && (
                            <div style={{ marginBottom: "40px", pageBreakInside: "avoid" }}>
                                <SectionHeader
                                    emoji={<Lock className="w-6 h-6 text-amber-500" />}
                                    title="Hold List — Do Not Process"
                                    subtitle={`${holdItems.length} item${holdItems.length !== 1 ? "s" : ""} originally due this week but deferred by management. Your accounting software may still show these as due.`}
                                    color="#f59e0b"
                                />

                                {holdItems.length === 0 ? (
                                    <EmptySection message="No items were deferred out of this week." />
                                ) : (
                                    <>
                                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                                            <thead>
                                                <tr style={{ borderBottom: "1px solid #cbd5e1" }}>
                                                    <th style={{ width: "28px" }} />
                                                    <th style={{ textAlign: "left", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Party / Ref #</th>
                                                    <th style={{ textAlign: "right", padding: "4px 12px 8px 0", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Amount</th>
                                                    <th style={{ textAlign: "left", padding: "4px 0 8px", fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", fontWeight: 600 }}>Management Instruction</th>
                                                    <th style={{ width: "130px" }} />
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {holdItems.map(({ item, originalDue }) => (
                                                    <ItemRow key={item.id} item={item} isHold originalDue={originalDue} />
                                                ))}
                                            </tbody>
                                        </table>
                                        <div style={{
                                            marginTop: "12px", padding: "8px 12px",
                                            background: "#fffbeb", border: "1px solid #fde68a",
                                            borderRadius: "6px", fontSize: "10px", color: "#78350f"
                                        }}>
                                            ℹ If a vendor or customer contacts you about an item on this list, escalate to management before taking action.
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* ── Signature footer ─────────────────────────────────────── */}
                        <div style={{
                            borderTop: "1px solid #e2e8f0",
                            paddingTop: "24px",
                            marginTop: "40px",
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr 1fr",
                            gap: "40px",
                        }}>
                            {["Prepared by", "Reviewed by", "Authorized by"].map(label => (
                                <div key={label}>
                                    <div style={{ borderBottom: "1px solid #94a3b8", height: "28px", marginBottom: "6px" }} />
                                    <p style={{ fontSize: "10px", color: "#94a3b8" }}>{label}</p>
                                </div>
                            ))}
                        </div>

                        <p style={{ fontSize: "9px", color: "#cbd5e1", textAlign: "center", marginTop: "32px" }}>
                            Generated by Cash Flow Decision OS · {printDate} · This document is confidential and intended for internal use only.
                        </p>
                    </div>
                </div>
            </div>
        </>
    );
}
