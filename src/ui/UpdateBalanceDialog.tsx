"use client";

import { useState } from "react";
import { CheckCircle2, Inbox, Upload, X } from "lucide-react";

export type TriageItem = {
    id: string;
    kind: "ar" | "ap";
    label: string;
    subLabel: string;
    amount: number;
    expectedDate: string;
    confidence?: string;
};

export type WeekOption = {
    weekNumber: number;
    label: string;
    weekStart: string;
};

export type TriageDecision = {
    action: "snooze" | "mark_paid" | "dismiss";
    weekStart?: string;
};

function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface Props {
    currentBalance: number;
    currentAdjustments: Array<{ type: string; amount: number; note: string | null }>;
    companyId: string;
    onSaved: () => void;
    onCancel: () => void;
}

export function UpdateBalanceDialog({
    currentBalance,
    currentAdjustments,
    companyId,
    onSaved,
    onCancel,
}: Props) {
    const todayISO = new Date().toISOString().slice(0, 10);
    const [step, setStep] = useState<"balance" | "triage" | "summary">("balance");
    const [balance, setBalance] = useState(currentBalance.toString());
    const [asOfDate, setAsOfDate] = useState(todayISO);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Triage state
    const [triageItems, setTriageItems] = useState<TriageItem[]>([]);
    const [weekOptions, setWeekOptions] = useState<WeekOption[]>([]);
    const [decisions, setDecisions] = useState<Record<string, TriageDecision>>({});
    const [triageLoading, setTriageLoading] = useState(false);
    const [triageSaving, setTriageSaving] = useState(false);

    // Summary state
    const [summary, setSummary] = useState<{
        snoozed: number; markedPaid: number; dismissed: number;
        newBalance: number;
    } | null>(null);

    const [adjustments, setAdjustments] = useState(
        currentAdjustments.map(a => ({ ...a, id: Math.random().toString(36).slice(2) }))
    );

    const [newAdjType, setNewAdjType] = useState("uncleared_check");
    const [newAdjAmount, setNewAdjAmount] = useState("");
    const [newAdjNote, setNewAdjNote] = useState("");

    const parsedBalance = parseFloat(balance.replace(/[$,\s]/g, ""));
    const isValid = !isNaN(parsedBalance);

    const adjTotal = adjustments.reduce((sum, a) => sum + a.amount, 0);
    const adjustedStartingCash = isValid ? parsedBalance + adjTotal : 0;

    const handleAddAdjustment = () => {
        const amt = parseFloat(newAdjAmount.replace(/[$,\s]/g, ""));
        if (isNaN(amt) || amt === 0) return;
        const finalAmt = newAdjType === "uncleared_check" ? -Math.abs(amt) : Math.abs(amt);
        setAdjustments([...adjustments, {
            id: Math.random().toString(36).slice(2),
            type: newAdjType,
            amount: finalAmt,
            note: newAdjNote || null
        }]);
        setNewAdjAmount("");
        setNewAdjNote("");
    };

    const handleRemoveAdj = (id: string) => {
        setAdjustments(adjustments.filter(a => a.id !== id));
    };

    const handleSave = async () => {
        if (!isValid) { setError("Enter a valid dollar amount"); return; }
        setSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/cash-checkin", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    bankBalance: parsedBalance,
                    asOfDate,
                    adjustments: adjustments.map(({ id: _, ...rest }) => rest),
                }),
            });
            if (!res.ok) { setError("Failed to save — try again"); setSaving(false); return; }

            setTriageLoading(true);
            const triageRes = await fetch(`/api/triage?companyId=${companyId}`);
            const triageData = await triageRes.json();
            setTriageLoading(false);
            setSaving(false);

            const allSlipped: TriageItem[] = [
                ...(triageData.slippedAR || []),
                ...(triageData.slippedAP || []),
            ];
            setWeekOptions(triageData.weekOptions || []);
            setTriageItems(allSlipped);

            if (allSlipped.length === 0) {
                setSummary({ snoozed: 0, markedPaid: 0, dismissed: 0, newBalance: parsedBalance + adjTotal });
                setStep("summary");
            } else {
                setStep("triage");
            }
        } catch {
            setError("Network error");
            setSaving(false);
            setTriageLoading(false);
        }
    };

    const handleTriageSubmit = async () => {
        setTriageSaving(true);
        const actions = triageItems.map(item => ({
            id: item.id,
            kind: item.kind,
            action: decisions[item.id]?.action ?? "dismiss",
            weekStart: decisions[item.id]?.weekStart,
        }));

        try {
            const res = await fetch("/api/triage/resolve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, actions }),
            });
            const data = await res.json();
            setSummary({
                snoozed: data.snoozed ?? 0,
                markedPaid: data.markedPaid ?? 0,
                dismissed: triageItems.length - (data.snoozed ?? 0) - (data.markedPaid ?? 0),
                newBalance: parsedBalance + adjTotal,
            });
            setStep("summary");
        } catch {
            setSummary({ snoozed: 0, markedPaid: 0, dismissed: triageItems.length, newBalance: parsedBalance + adjTotal });
            setStep("summary");
        } finally {
            setTriageSaving(false);
        }
    };

    const setDecision = (id: string, decision: TriageDecision) => {
        setDecisions(prev => ({ ...prev, [id]: decision }));
    };

    const gaugeMax = Math.max(Math.abs(adjustedStartingCash) * 2, 50000);
    const gaugePct = isValid ? Math.max(0, Math.min(adjustedStartingCash / gaugeMax, 1)) : 0;
    const gaugeColor = adjustedStartingCash < 0 ? "#f87171"
        : adjustedStartingCash < (currentBalance * 0.3) ? "#fbbf24"
            : "#34d399";

    const RADIUS = 54;
    const CIRC = 2 * Math.PI * RADIUS;
    const ARC_RATIO = 0.75;
    const arcLen = CIRC * ARC_RATIO;
    const fillLen = arcLen * gaugePct;
    const dashOffset = CIRC * (1 - ARC_RATIO) / 2;

    const shell = (children: React.ReactNode) => (
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-overlay-enter"
            style={{ background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(12px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <div
                className="relative w-full max-w-2xl rounded-3xl border overflow-hidden modal-card-enter shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)]"
                style={{
                    background: "white",
                    borderColor: "var(--border-default)",
                }}
            >
                {children}
            </div>
        </div>
    );

    if (step === "balance") return shell(
        <>
            <div className="flex items-center gap-8 px-8 pt-8 pb-6 bg-slate-50/50">
                <div className="relative shrink-0 p-1 rounded-full bg-white shadow-sm border border-slate-100">
                    <svg width={150} height={150} viewBox="0 0 130 130">
                        <circle cx={65} cy={65} r={RADIUS} fill="none" stroke="#f1f5f9" strokeWidth={12}
                            strokeDasharray={`${arcLen} ${CIRC}`} strokeDashoffset={-dashOffset} strokeLinecap="round" transform="rotate(-225 65 65)" />
                        <circle cx={65} cy={65} r={RADIUS} fill="none" stroke={gaugeColor} strokeWidth={12}
                            strokeDasharray={`${fillLen} ${CIRC}`} strokeDashoffset={-dashOffset} strokeLinecap="round"
                            transform="rotate(-225 65 65)"
                            style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }} />
                        <text x={65} y={60} textAnchor="middle" fill="var(--text-primary)" fontSize={15} fontWeight="900" fontFamily="monospace">
                            {isValid ? fmt(adjustedStartingCash) : "—"}
                        </text>
                        <text x={65} y={76} textAnchor="middle" fill="var(--text-muted)" fontSize={7} fontWeight="800" letterSpacing="0.1em" fontFamily="sans-serif">SPENDABLE</text>
                    </svg>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-lg border bg-blue-50 text-blue-600 border-blue-100 italic">Roll Protocol</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Step 01 / 03</span>
                    </div>
                    <h2 className="text-2xl font-black mt-0.5 leading-tight text-slate-900">Check-in Terminal</h2>
                    <p className="text-sm mt-3 leading-relaxed text-slate-500 font-medium">
                        Synchronize your actual cash position to begin the 13-week forecast roll sequence.
                    </p>
                </div>
                <button onClick={onCancel} className="absolute top-6 right-6 w-10 h-10 flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all shadow-sm active:scale-95 text-slate-400 hover:text-slate-900">
                    <X className="w-5 h-5" />
                </button>
            </div>

            <div className="mx-7 border-t" style={{ borderColor: "var(--border-subtle)" }} />

            <div className="px-7 py-5 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <div className="flex gap-3">
                        <div className="flex-1">
                            <label className="text-xs uppercase tracking-wider block mb-1.5" style={{ color: "var(--text-muted)" }}>Bank Statement Balance</label>
                            <div className="relative group/input">
                                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm pointer-events-none transition-colors" style={{ color: "var(--text-faint)" }}>$</span>
                                <input id="update-bank-balance-input" type="text" inputMode="decimal"
                                    value={balance} onChange={e => setBalance(e.target.value)} placeholder="0.00"
                                    className="w-full border focus:border-blue-500 focus:outline-none rounded-xl pl-8 pr-3 py-2.5 text-sm font-financial font-bold transition-all"
                                    style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                            </div>
                        </div>
                        <div className="w-[130px]">
                            <label className="text-xs uppercase tracking-wider block mb-1.5" style={{ color: "var(--text-muted)" }}>As-of Date</label>
                            <input id="update-balance-date-input" type="date" value={asOfDate} onChange={e => setAsOfDate(e.target.value)}
                                className="w-full border focus:border-blue-500 focus:outline-none rounded-xl px-3 py-2.5 text-sm appearance-none"
                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                        </div>
                    </div>
                    <div className="rounded-xl p-3 border space-y-1.5" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                        <p className="text-xs uppercase tracking-wider mb-2" style={{ color: "var(--text-faint)" }}>Breakdown</p>
                        <div className="flex justify-between text-sm">
                            <span style={{ color: "var(--text-muted)" }}>Statement</span>
                            <span className="font-financial" style={{ color: "var(--text-primary)" }}>{fmt(parsedBalance || 0)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span style={{ color: "var(--text-muted)" }}>Adjustments</span>
                            <span className={`font-financial ${adjTotal >= 0 ? "text-emerald-600" : "text-red-500"}`}>{adjTotal >= 0 ? "+" : ""}{fmt(adjTotal)}</span>
                        </div>
                        <div className="flex justify-between pt-2 mt-1 border-t font-bold" style={{ borderColor: "var(--border-subtle)" }}>
                            <span className="text-xs uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>Spendable Cash</span>
                            <span className="font-financial text-base" style={{ color: gaugeColor }}>{fmt(adjustedStartingCash)}</span>
                        </div>
                    </div>
                </div>

                <div className="space-y-3">
                    <label className="text-xs uppercase tracking-wider block" style={{ color: "var(--text-muted)" }}>Outstanding Items</label>
                    <div className="max-h-[120px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                        {adjustments.length === 0 ? (
                            <p className="text-[11px] italic py-2" style={{ color: "var(--text-faint)" }}>No outstanding items.</p>
                        ) : (
                            adjustments.map(a => (
                                <div key={a.id} className="flex items-center justify-between border rounded-lg px-2.5 py-1.5 group" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                                    <div className="min-w-0">
                                        <p className="text-xs truncate" style={{ color: "var(--text-secondary)" }}>{a.note || a.type.replace(/_/g, " ")}</p>
                                        <p className="text-[11px] uppercase" style={{ color: "var(--text-faint)" }}>{a.type.replace(/_/g, " ")}</p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className={`text-xs font-financial ${a.amount >= 0 ? "text-emerald-600" : "text-red-500"}`}>{a.amount >= 0 ? "+" : ""}{fmt(a.amount)}</span>
                                        <button onClick={() => handleRemoveAdj(a.id)} className="opacity-0 group-hover:opacity-100 text-xs hover:text-red-400 transition-opacity" style={{ color: "var(--text-muted)" }}>✕</button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="flex gap-2 p-2 rounded-xl" style={{ background: "var(--bg-raised)" }}>
                        <select value={newAdjType} onChange={e => setNewAdjType(e.target.value)}
                            className="border rounded-lg text-[11px] px-1.5 py-1 focus:outline-none w-[90px] shrink-0"
                            style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
                            <option value="uncleared_check">Check (–)</option>
                            <option value="pending_deposit">Deposit (+)</option>
                            <option value="other">Other</option>
                        </select>
                        <div className="w-[85px] relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] pointer-events-none transition-colors" style={{ color: "var(--text-faint)" }}>$</span>
                            <input type="text" placeholder="Amount" value={newAdjAmount}
                                onChange={e => setNewAdjAmount(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && handleAddAdjustment()}
                                className="w-full border rounded-lg pl-5 pr-2 py-1 text-[11px] focus:outline-none focus:border-blue-500 font-financial"
                                style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                        </div>
                        <input type="text" placeholder="Note" value={newAdjNote}
                            onChange={e => setNewAdjNote(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleAddAdjustment()}
                            className="border rounded-lg text-[11px] px-2 py-1 focus:outline-none focus:border-blue-500 flex-1 min-w-0"
                            style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)", color: "var(--text-primary)" }} />
                        <button onClick={handleAddAdjustment}
                            className="px-3 rounded-lg text-white text-sm font-bold hover:brightness-110 shrink-0"
                            style={{ background: "var(--color-primary)", border: "1px solid var(--color-primary)" }}>+</button>
                    </div>
                </div>
            </div>

            <div className="px-7 pb-7 flex items-center gap-3">
                <button id="confirm-balance-update-btn" onClick={handleSave} disabled={saving || triageLoading || !isValid}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-all active:scale-95 shadow-lg shadow-indigo-200"
                    style={{ background: "var(--color-primary)" }}>
                    {saving || triageLoading ? "Rolling Forecast…" : "✓ Confirm & Roll Forecast →"}
                </button>
                <button onClick={onCancel}
                    className="px-5 py-3 rounded-xl text-sm font-medium border transition-colors hover:text-white"
                    style={{ color: "var(--text-muted)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}>Cancel</button>
            </div>
        </>
    );

    if (step === "triage") {
        const totalAmount = triageItems.reduce((s, i) => s + i.amount, 0);
        const allDecided = triageItems.every(i => decisions[i.id]);

        return shell(
            <>
                <div className="px-7 pt-7 pb-4">
                    <p className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: "var(--color-caution)" }}>Weekly Roll Ritual · Step 2 of 3</p>
                    <h2 className="text-lg font-bold leading-tight" style={{ color: "var(--text-primary)" }}>Backlog Clearance</h2>
                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                        {triageItems.length} item{triageItems.length !== 1 ? "s" : ""} ({fmt(totalAmount)}) fell into your backlog. Schedule them into a future week, clear them, or leave them here for later.
                    </p>
                </div>

                <div className="mx-7 border-t" style={{ borderColor: "var(--border-subtle)" }} />

                <div className="px-7 py-4 max-h-[340px] overflow-y-auto space-y-3 custom-scrollbar">
                    {triageItems.map(item => {
                        const dec = decisions[item.id];
                        return (
                            <div key={item.id} className="rounded-xl border p-3 space-y-2 transition-colors"
                                style={{
                                    borderColor: dec ? "rgba(34,197,94,0.25)" : "var(--border-subtle)",
                                    background: dec ? "rgba(20,83,45,0.05)" : "var(--bg-raised)",
                                }}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-[11px] px-1.5 py-0.5 rounded font-bold uppercase ${
                                                item.kind === "ar" ? "text-emerald-600 bg-emerald-100" : "text-red-600 bg-red-100"
                                            }`}>{item.kind === "ar" ? <><Inbox className="w-3.5 h-3.5 inline mr-1"/> AR</> : <><Upload className="w-3.5 h-3.5 inline mr-1"/> AP</>}</span>
                                            <p className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>{item.label}</p>
                                        </div>
                                        <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>{item.subLabel}</p>
                                    </div>
                                    <p className={`text-sm font-financial font-bold shrink-0 ${
                                        item.kind === "ar" ? "text-emerald-600" : "text-red-600"
                                    }`}>{item.kind === "ar" ? "+" : "–"}{fmt(item.amount)}</p>
                                </div>

                                <div className="flex flex-wrap gap-1.5">
                                    {weekOptions.slice(0, 3).map(wk => (
                                        <button key={wk.weekStart}
                                            onClick={() => setDecision(item.id, { action: "snooze", weekStart: wk.weekStart })}
                                            className="text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors"
                                            style={{
                                                borderColor: dec?.action === "snooze" && dec.weekStart === wk.weekStart
                                                    ? "var(--color-primary)" : "var(--border-subtle)",
                                                background: dec?.action === "snooze" && dec.weekStart === wk.weekStart
                                                    ? "var(--color-primary-glow)" : "var(--bg-surface)",
                                                color: dec?.action === "snooze" && dec.weekStart === wk.weekStart
                                                    ? "var(--color-primary)" : "var(--text-muted)",
                                            }}
                                        >→ W{wk.weekNumber}</button>
                                    ))}
                                    <button onClick={() => setDecision(item.id, { action: "mark_paid" })}
                                        className="text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors"
                                        style={{
                                            borderColor: dec?.action === "mark_paid" ? "rgba(34,197,94,0.5)" : "var(--border-subtle)",
                                            background: dec?.action === "mark_paid" ? "rgba(34,197,94,0.1)" : "var(--bg-surface)",
                                            color: dec?.action === "mark_paid" ? "#15803d" : "var(--text-muted)",
                                        }}>✓ Cleared</button>
                                    <button onClick={() => setDecision(item.id, { action: "dismiss" })}
                                        className="text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors"
                                        style={{
                                            borderColor: dec?.action === "dismiss" ? "var(--text-muted)" : "var(--border-subtle)",
                                            background: dec?.action === "dismiss" ? "var(--bg-raised)" : "var(--bg-surface)",
                                            color: "var(--text-muted)",
                                        }}>× Leave in Backlog</button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="px-7 pb-7 pt-3 flex items-center gap-3">
                    <button onClick={handleTriageSubmit} disabled={triageSaving}
                        className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-all active:scale-95 shadow-lg shadow-amber-200"
                        style={{ background: "var(--color-caution)" }}>
                        {triageSaving ? "Saving…" : allDecided ? "✓ Apply Decisions →" : `Apply (${Object.keys(decisions).length}/${triageItems.length} decided) →`}
                    </button>
                    <button onClick={() => {
                        const actions = triageItems.map(i => ({ id: i.id, kind: i.kind, action: "dismiss" as const }));
                        fetch("/api/triage/resolve", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ companyId, actions }),
                        });
                        setSummary({ snoozed: 0, markedPaid: 0, dismissed: triageItems.length, newBalance: parsedBalance + adjTotal });
                        setStep("summary");
                    }} className="px-4 py-3 rounded-xl text-xs border transition-colors hover:text-white"
                        style={{ color: "var(--text-muted)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}>Skip →</button>
                </div>
            </>
        );
    }

    if (step === "summary" && summary) return shell(
        <div className="px-7 py-10 flex flex-col items-center text-center gap-5">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl"
                style={{ background: "rgba(16,185,129,0.10)", border: "2px solid rgba(52,211,153,0.3)" }}>
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            </div>

            <div>
                <p className="text-xs text-emerald-600 font-bold uppercase tracking-widest mb-1">Week Roll Complete</p>
                <h2 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>You&apos;re all set for the week</h2>
                <p className="text-sm mt-2" style={{ color: "var(--text-muted)" }}>
                    Your 13-week runway is now refreshed and accurate.
                </p>
            </div>

            <div className="w-full grid grid-cols-3 gap-3">
                {[
                    { label: "New Spendable Cash", value: fmt(summary.newBalance), color: summary.newBalance >= 0 ? "var(--color-positive)" : "var(--color-danger)" },
                    { label: "Scheduled Items", value: summary.snoozed.toString(), color: "var(--color-primary)" },
                    { label: "Cleared / Paid", value: summary.markedPaid.toString(), color: "var(--color-positive)" },
                ].map(stat => (
                    <div key={stat.label} className="rounded-xl p-3 border" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                        <p className="text-xs font-bold" style={{ color: stat.color }}>{stat.value}</p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-faint)" }}>{stat.label}</p>
                    </div>
                ))}
            </div>

            <button onClick={onSaved}
                className="w-full py-4 rounded-2xl text-sm font-black text-white transition-all active:scale-[0.98] mt-4 shadow-xl shadow-emerald-200/50 bg-emerald-600 hover:bg-emerald-500"
            >
                Confirm & Sync Dashboard →
            </button>
        </div>
    );

    return null;
}
