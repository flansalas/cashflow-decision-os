"use client";

import { useState } from "react";
import { CheckCircle2, Inbox, Upload, X, TrendingUp, Landmark, AlertTriangle, ShieldCheck, ShieldAlert } from "lucide-react";
import { VarianceDriverPanel } from "@/ui/VarianceDriverPanel";
import type { VarianceDriverResult } from "@/services/variance-drivers";
import { ARAPUploadStep } from "@/ui/ARAPUploadStep";
import { BankUploadStep } from "@/ui/BankUploadStep";

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
    executionPlanId?: string;
    priorWeekData?: any;
    priorWeekActions?: any[];
    lastUpdated?: string | null;
    onSaved: () => void;
    onCancel: () => void;
}

export function UpdateBalanceDialog({
    currentBalance,
    currentAdjustments,
    companyId,
                    
    executionPlanId,
    priorWeekData,
    priorWeekActions = [],
    lastUpdated,
    onSaved,
    onCancel,
}: Props) {
    const todayISO = new Date().toISOString().slice(0, 10);
    const [step, setStep] = useState<"upload" | "bank" | "uncleared" | "balance" | "preview" | "actions" | "triage" | "summary">("upload");
    const [balance, setBalance] = useState(currentBalance.toString());
    const [asOfDate, setAsOfDate] = useState(todayISO);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Bank upload tracking (UI context)
    const [bankUploaded, setBankUploaded] = useState(false);
    const [bankSkipped, setBankSkipped] = useState(false);
    const [arapUploaded, setArapUploaded] = useState(false);
    // Controls whether BankUploadStep is revealed in the bank step
    const [showBankUploadWidget, setShowBankUploadWidget] = useState(false);
    // API-backed bank row presence for the closing week — used for preview verification
    const [bankDataDetected, setBankDataDetected] = useState<boolean | null>(null);
    const [bankDataRowCount, setBankDataRowCount] = useState<number | null>(null);
    const [bankStatusLoading, setBankStatusLoading] = useState(false);

    // Triage state
    const [triageItems, setTriageItems] = useState<TriageItem[]>([]);
    const [weekOptions, setWeekOptions] = useState<WeekOption[]>([]);
    const [decisions, setDecisions] = useState<Record<string, TriageDecision>>({});
    const [actionDecisions, setActionDecisions] = useState<Record<string, "completed" | "missed" | "deferred">>({});
    const [triageLoading, setTriageLoading] = useState(false);
    const [triageSaving, setTriageSaving] = useState(false);

    // Summary state
    const [summary, setSummary] = useState<{
        snoozed: number; markedPaid: number; dismissed: number;
        newBalance: number;
    } | null>(null);

    // Variance driver state
    const [checkpointId, setCheckpointId] = useState<string | null>(null);
    const [driverData, setDriverData] = useState<VarianceDriverResult | null>(null);
    const [driverLoading, setDriverLoading] = useState(false);
    const [driverOpen, setDriverOpen] = useState(false);
    const [driverError, setDriverError] = useState(false);

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
                    executionPlanId,
                    bankBalance: parsedBalance,
                    asOfDate,
                    adjustments: adjustments.map(({ id: _, ...rest }) => rest),
                    ...(priorWeekData ? {
                        priorWeekForecast: {
                            forecastVersionHash: "client_observed_v1",
                            generatedAt: lastUpdated || new Date().toISOString(),
                            weekStart: priorWeekData.weekStart,
                            weekEnd: priorWeekData.weekEnd,
                            endCashExpected: priorWeekData.endCashExpected,
                            inflowsExpected: priorWeekData.inflowsExpected,
                            outflowsExpected: priorWeekData.outflowsExpected,
                            breakdownJson: priorWeekData.breakdown ? JSON.stringify(priorWeekData.breakdown) : undefined,
                        }
                    } : {})
                }),
            });
            if (!res.ok) { setError("Failed to save — try again"); setSaving(false); return; }

            // Read response body once — capture checkpoint id for variance driver lookup
            try {
                const checkinData = await res.json();
                if (checkinData?.checkpoint?.id) {
                    setCheckpointId(checkinData.checkpoint.id);
                }
            } catch { /* non-blocking */ }

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

            if (priorWeekActions.length > 0) {
                setStep("actions");
            } else if (allSlipped.length === 0) {
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

    if (step === "upload") return shell(
        <div className="flex flex-col max-h-[85vh]">
            <button
                onClick={onCancel}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 transition-colors z-10"
                style={{ color: "var(--text-secondary)" }}
            >
                <X className="w-5 h-5" />
            </button>
            
            <div className="px-8 pt-8 pb-4 border-b border-slate-100/60 bg-white z-0">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-lg border bg-blue-50 text-blue-600 border-blue-100 italic">Roll Protocol • Step 1 of 4</span>
                <h2 className="text-2xl font-bold mt-3 tracking-tight" style={{ color: "var(--text-primary)" }}>Refresh AR &amp; AP Data</h2>
                <p className="text-[13px] mt-1.5" style={{ color: "var(--text-muted)" }}>
                    Upload your latest AR and AP aging reports to ensure your triage is based on reality.
                </p>
            </div>
            
            <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar bg-slate-50/50">
                <ARAPUploadStep companyId={companyId} onDone={() => { setArapUploaded(true); setStep("bank"); }} doneButtonText="Continue to Bank Transactions" />
            </div>
            
            <div className="px-8 py-4 border-t border-slate-100/60 bg-white flex justify-end">
                <button
                    onClick={() => setStep("bank")}
                    className="px-5 py-2 rounded-xl text-sm font-medium transition-colors border shadow-sm"
                    style={{ background: "var(--bg-surface)", color: "var(--text-primary)", borderColor: "var(--border-default)" }}
                >
                    Skip AR/AP — Continue to Bank Transactions
                </button>
            </div>
        </div>
    );

    if (step === "bank") return shell(
        <div className="flex flex-col max-h-[85vh]">
            <button
                onClick={onCancel}
                className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 transition-colors z-10"
                style={{ color: "var(--text-secondary)" }}
            >
                <X className="w-5 h-5" />
            </button>

            <div className="px-8 pt-8 pb-4 border-b border-slate-100/60 bg-white z-0">
                <span className="text-[10px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-lg border bg-indigo-50 text-indigo-600 border-indigo-100 italic">Roll Protocol • Step 2 of 4</span>
                <h2 className="text-2xl font-bold mt-3 tracking-tight" style={{ color: "var(--text-primary)" }}>Upload Bank Transactions</h2>
                <p className="text-[13px] mt-1.5" style={{ color: "var(--text-muted)" }}>
                    Upload your bank statement for the week being closed. This allows the app to verify your forecast and teach Macro-Memory from actual results.
                </p>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar bg-slate-50/50">
                {!showBankUploadWidget ? (
                    // ── Intro prompt — not yet chosen ──────────────────────────────
                    <div className="space-y-4">
                        <div className="rounded-xl border p-4 bg-indigo-50/60 border-indigo-100 space-y-2">
                            <div className="flex items-start gap-3">
                                <Landmark className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                                <div>
                                    <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Why bank transactions matter</p>
                                    <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                                        When bank transactions are present, your weekly roll is saved as <strong>Verified</strong> and Macro-Memory can learn from actual vs. forecast variance. Without them, the roll is saved as <strong>Unverified</strong> and no learning occurs.
                                    </p>
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowBankUploadWidget(true)}
                            className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 shadow-lg shadow-indigo-200"
                            style={{ background: "var(--color-primary)" }}
                        >
                            <Landmark className="w-4 h-4 inline mr-2" />
                            Upload Bank Transactions
                        </button>
                        <button
                            onClick={() => { setBankSkipped(true); setBankUploaded(false); setShowBankUploadWidget(false); setStep("balance"); }}
                            className="w-full py-2.5 rounded-xl text-sm font-medium border transition-colors"
                            style={{ background: "var(--bg-raised)", color: "var(--text-secondary)", borderColor: "var(--border-default)" }}
                        >
                            Skip bank transactions — roll will be unverified
                        </button>
                    </div>
                ) : (
                    // ── BankUploadStep revealed after user clicks upload ────────────
                    <BankUploadStep
                        companyId={companyId}
                        skipButtonText="Skip & Continue to Balance Review"
                        onDone={async () => {
                            setBankUploaded(true);
                            setBankSkipped(false);
                            setShowBankUploadWidget(false);
                            // Fetch updated adjustments in case auto-matching cleared some
                            try {
                                const res = await fetch(`/api/cash-adjustments?companyId=${companyId}`);
                                if (res.ok) {
                                    const data = await res.json();
                                    if (data.adjustments) {
                                        setAdjustments(data.adjustments.map((a: any) => ({ ...a, id: Math.random().toString(36).slice(2) })));
                                    }
                                }
                            } catch (e) {
                                console.error(e);
                            }
                            setStep("uncleared");
                        }}
                    />
                )}
            </div>

            {!showBankUploadWidget && (
                <div className="px-8 py-4 border-t border-slate-100/60 bg-white flex justify-start">
                    <button
                        onClick={() => setStep("upload")}
                        className="px-4 py-2 rounded-xl text-sm font-medium border transition-colors"
                        style={{ background: "var(--bg-surface)", color: "var(--text-muted)", borderColor: "var(--border-default)" }}
                    >
                        ← Back to AR/AP
                    </button>
                </div>
            )}
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
                <button
                    id="confirm-balance-update-btn"
                    onClick={async () => {
                        if (!isValid) return;
                        setBankStatusLoading(true);
                        try {
                            const params = new URLSearchParams({ companyId });
                            if (priorWeekData?.weekStart) params.append("weekStart", priorWeekData.weekStart);
                            if (priorWeekData?.weekEnd) params.append("weekEnd", priorWeekData.weekEnd);
                            const res = await fetch(`/api/upload/bank/status?${params}`);
                            if (res.ok) {
                                const data = await res.json();
                                setBankDataDetected(data.hasData);
                                setBankDataRowCount(data.rowCount);
                            } else {
                                setBankDataDetected(false);
                                setBankDataRowCount(0);
                            }
                        } catch {
                            // Non-blocking: if check fails, conservatively treat as not detected
                            setBankDataDetected(false);
                            setBankDataRowCount(0);
                        } finally {
                            setBankStatusLoading(false);
                            setStep("preview");
                        }
                    }}
                    disabled={!isValid || bankStatusLoading}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-all active:scale-95 shadow-lg shadow-indigo-200"
                    style={{ background: "var(--color-primary)" }}
                >
                    {bankStatusLoading ? "Checking bank data\u2026" : "Review \u0026 Confirm Roll \u2192"}
                </button>
                <button onClick={onCancel}
                    className="px-5 py-3 rounded-xl text-sm font-medium border transition-colors hover:text-white"
                    style={{ color: "var(--text-muted)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}>Cancel</button>
            </div>
        </>
    );

    // ── Pre-Roll Preview Step ─────────────────────────────────────────────────
    if (step === "preview") {
        const weekLabel = priorWeekData?.weekStart && priorWeekData?.weekEnd
            ? `${new Date(priorWeekData.weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(priorWeekData.weekEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
            : asOfDate;
        const variance = priorWeekData?.endCashExpected != null
            ? (parsedBalance + adjTotal) - priorWeekData.endCashExpected
            : null;
        const isVerified = bankDataDetected === true;

        return shell(
            <div className="flex flex-col max-h-[85vh]">
                <button
                    onClick={onCancel}
                    className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 transition-colors z-10"
                    style={{ color: "var(--text-secondary)" }}
                >
                    <X className="w-5 h-5" />
                </button>

                <div className="px-8 pt-8 pb-4 border-b border-slate-100/60 bg-white z-0">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-lg border bg-emerald-50 text-emerald-600 border-emerald-100 italic">Roll Protocol • Step 4 of 4</span>
                    <h2 className="text-2xl font-bold mt-3 tracking-tight" style={{ color: "var(--text-primary)" }}>Pre-Roll Preview</h2>
                    <p className="text-[13px] mt-1.5" style={{ color: "var(--text-muted)" }}>
                        Review the roll details below before advancing the week.
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto px-8 py-5 custom-scrollbar bg-slate-50/50 space-y-4">
                    {/* Week summary row */}
                    <div className="rounded-xl border p-4 space-y-3" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
                        <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--text-faint)" }}>Week Closing</p>
                        <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{weekLabel}</p>

                        <div className="grid grid-cols-2 gap-3 pt-1">
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span style={{ color: "var(--text-muted)" }}>AR / AP Upload</span>
                                    <span className={arapUploaded ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>
                                        {arapUploaded ? "✓ Uploaded" : "○ Skipped"}
                                    </span>
                                </div>
                                <div className="flex justify-between text-xs">
                                    <span style={{ color: "var(--text-muted)" }}>Bank Transactions</span>
                                    <span className={bankDataDetected ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>
                                        {bankDataDetected
                                            ? `✓ Detected${bankDataRowCount != null ? ` (${bankDataRowCount} rows)` : ""}`
                                            : "⚠ Not Detected for Closing Week"}
                                    </span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs">
                                    <span style={{ color: "var(--text-muted)" }}>Ending Bank Balance</span>
                                    <span className="font-financial font-bold" style={{ color: "var(--text-primary)" }}>{fmt(parsedBalance + adjTotal)}</span>
                                </div>
                                {priorWeekData?.endCashExpected != null && (
                                    <div className="flex justify-between text-xs">
                                        <span style={{ color: "var(--text-muted)" }}>Forecast Expected Cash</span>
                                        <span className="font-financial font-bold" style={{ color: "var(--text-primary)" }}>{fmt(priorWeekData.endCashExpected)}</span>
                                    </div>
                                )}
                                {variance != null && (
                                    <div className="flex justify-between text-xs">
                                        <span style={{ color: "var(--text-muted)" }}>Variance</span>
                                        <span className={`font-financial font-bold ${variance >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                                            {variance >= 0 ? "+" : ""}{fmt(variance)}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Verification status */}
                    <div className={`rounded-xl border p-4 flex items-start gap-3 ${
                        isVerified ? "bg-emerald-50/60 border-emerald-100" : "bg-amber-50/60 border-amber-200"
                    }`}>
                        {isVerified
                            ? <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                            : <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />}
                        <div>
                            <p className={`text-sm font-bold ${isVerified ? "text-emerald-700" : "text-amber-700"}`}>
                                {isVerified ? "Verified with bank transactions" : "Unverified — bank transactions missing"}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                                {isVerified
                                    ? "Baseline Variance Ledger will be created. Macro-Memory will learn from this week."
                                    : "Baseline Variance Ledger will NOT be created. Macro-Memory will not learn from this week."}
                            </p>
                        </div>
                    </div>

                    {/* Warning block if bank skipped */}
                    {!isVerified && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                            <div className="flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                    Bank transactions were not uploaded. This roll can continue, but it will be saved as unverified. Macro-Memory will not learn from this week unless bank transactions are uploaded before the roll or a future reprocess feature is added.
                                </p>
                            </div>
                            <button
                                onClick={() => { setShowBankUploadWidget(false); setStep("bank"); }}
                                className="w-full py-2 rounded-xl text-sm font-semibold border transition-colors"
                                style={{ background: "var(--bg-surface)", color: "var(--color-primary)", borderColor: "var(--color-primary)" }}
                            >
                                Upload Bank Transactions Now
                            </button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-8 py-4 border-t border-slate-100/60 bg-white flex items-center gap-3">
                    <button onClick={() => setStep("balance")}
                        className="px-4 py-3 rounded-xl text-sm font-medium border transition-colors"
                        style={{ color: "var(--text-muted)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}
                    >← Back</button>

                    <button
                        id="advance-week-confirm-btn"
                        onClick={handleSave}
                        disabled={saving || triageLoading || !isValid}
                        className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-all active:scale-95 shadow-lg shadow-indigo-200"
                        style={{ background: isVerified ? "var(--color-positive)" : "var(--color-primary)" }}
                    >
                        {saving || triageLoading
                            ? "Rolling Forecast…"
                            : isVerified
                                ? "✓ Advance Week (Verified) →"
                                : "Continue Without Bank Data →"}
                    </button>

                    <button onClick={onCancel}
                        className="px-4 py-3 rounded-xl text-sm font-medium border transition-colors"
                        style={{ color: "var(--text-muted)", borderColor: "var(--border-default)", background: "var(--bg-raised)" }}
                    >Cancel</button>
                </div>
            </div>
        );
    }

    if (step === "actions") {
        const allDecided = priorWeekActions.every(a => actionDecisions[a.id]);

        const handleActionsSubmit = async () => {
            // In a real app we'd save these via a new endpoint /api/actions/resolve.
            // For now, we capture them in state and move to triage.
            if (triageItems.length === 0) {
                setSummary({ snoozed: 0, markedPaid: 0, dismissed: 0, newBalance: parsedBalance + adjTotal });
                setStep("summary");
            } else {
                setStep("triage");
            }
        };

        return shell(
            <>
                <div className="px-7 pt-7 pb-4">
                    <p className="text-xs font-bold uppercase tracking-widest mb-1 text-indigo-600">Action Accountability</p>
                    <h2 className="text-lg font-bold leading-tight text-slate-900">Review Last Week's Plan</h2>
                    <p className="text-xs mt-1 text-slate-500">
                        Did you complete the actions you committed to last week?
                    </p>
                </div>

                <div className="mx-7 border-t border-slate-200" />

                <div className="px-7 py-4 max-h-[340px] overflow-y-auto space-y-3 custom-scrollbar">
                    {priorWeekActions.map(action => {
                        const dec = actionDecisions[action.id];
                        return (
                            <div key={action.id} className="rounded-xl border p-3 space-y-2 transition-colors border-slate-200 bg-slate-50">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-800">{action.title}</p>
                                        <p className="text-xs mt-0.5 text-slate-500">{action.description}</p>
                                    </div>
                                    <p className={`text-sm font-financial font-bold shrink-0 ${action.amountImpact >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                                        {action.amountImpact > 0 ? "+" : ""}{fmt(action.amountImpact)}
                                    </p>
                                </div>

                                <div className="flex flex-wrap gap-1.5 pt-2">
                                    <button onClick={() => setActionDecisions(prev => ({ ...prev, [action.id]: "completed" }))}
                                        className="text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors"
                                        style={{
                                            borderColor: dec === "completed" ? "rgba(34,197,94,0.5)" : "var(--border-subtle)",
                                            background: dec === "completed" ? "rgba(34,197,94,0.1)" : "var(--bg-surface)",
                                            color: dec === "completed" ? "#15803d" : "var(--text-muted)",
                                        }}>✓ Completed</button>
                                    <button onClick={() => setActionDecisions(prev => ({ ...prev, [action.id]: "deferred" }))}
                                        className="text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors"
                                        style={{
                                            borderColor: dec === "deferred" ? "rgba(245,158,11,0.5)" : "var(--border-subtle)",
                                            background: dec === "deferred" ? "rgba(245,158,11,0.1)" : "var(--bg-surface)",
                                            color: dec === "deferred" ? "#b45309" : "var(--text-muted)",
                                        }}>→ Deferred</button>
                                    <button onClick={() => setActionDecisions(prev => ({ ...prev, [action.id]: "missed" }))}
                                        className="text-xs px-2.5 py-1 rounded-lg border font-semibold transition-colors"
                                        style={{
                                            borderColor: dec === "missed" ? "rgba(239,68,68,0.5)" : "var(--border-subtle)",
                                            background: dec === "missed" ? "rgba(239,68,68,0.1)" : "var(--bg-surface)",
                                            color: dec === "missed" ? "#b91c1c" : "var(--text-muted)",
                                        }}>× Missed</button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="px-7 pb-7 pt-3 flex items-center gap-3">
                    <button
                        onClick={handleActionsSubmit}
                        disabled={!allDecided}
                        className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 transition-all active:scale-95 shadow-lg shadow-indigo-200"
                        style={{ background: "var(--color-primary)" }}
                    >
                        Continue to Triage →
                    </button>
                </div>
            </>
        );
    }

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
                {priorWeekData && typeof priorWeekData.endCashExpected === "number" && (
                    <div className="col-span-3 mb-2 p-4 rounded-xl border flex justify-between items-center bg-gray-50 dark:bg-gray-800/50" style={{ borderColor: "var(--border-subtle)" }}>
                        <div className="text-left">
                            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">Variance</p>
                            <p className="text-sm">
                                <span className="font-semibold text-gray-700 dark:text-gray-300">Expected:</span> {fmt(priorWeekData.endCashExpected)}
                            </p>
                        </div>
                        <div className="text-right">
                            <p className="text-lg font-bold" style={{ color: (summary.newBalance - priorWeekData.endCashExpected) >= 0 ? "var(--color-positive)" : "var(--color-danger)" }}>
                                {(summary.newBalance - priorWeekData.endCashExpected) > 0 ? "+" : ""}{fmt(summary.newBalance - priorWeekData.endCashExpected)}
                            </p>
                            <p className="text-xs text-gray-500">vs Prior Projection</p>
                        </div>
                    </div>
                )}

                {/* ── Why did this change? ─────────────────────────────────── */}
                {priorWeekData && typeof priorWeekData.endCashExpected === "number" && (
                    <div className="col-span-3 mt-1">
                        <button
                            onClick={async () => {
                                if (driverOpen) { setDriverOpen(false); return; }
                                setDriverOpen(true);
                                if (driverData) return; // already loaded
                                setDriverLoading(true);
                                setDriverError(false);
                                try {
                                    const url = checkpointId
                                        ? `/api/variance-drivers?checkpointId=${checkpointId}`
                                        : "/api/variance-drivers?latest=true";
                                    const r = await fetch(url);
                                    if (!r.ok) throw new Error("not ok");
                                    setDriverData(await r.json());
                                } catch {
                                    setDriverError(true);
                                } finally {
                                    setDriverLoading(false);
                                }
                            }}
                            className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 transition-colors py-1"
                        >
                            <TrendingUp className="w-3.5 h-3.5" />
                            {driverOpen ? "Hide explanation ↑" : "Why did this change? →"}
                        </button>

                        {driverOpen && (
                            <div className="mt-2 rounded-xl border border-slate-100 bg-white p-4 max-h-[340px] overflow-y-auto custom-scrollbar">
                                {driverLoading && (
                                    <div className="flex items-center gap-2 text-xs text-slate-400 py-4 justify-center">
                                        <span className="animate-spin w-4 h-4 border-2 border-slate-300 border-t-indigo-500 rounded-full" />
                                        Loading variance breakdown…
                                    </div>
                                )}
                                {driverError && !driverLoading && (
                                    <p className="text-xs text-slate-400 text-center py-4">Variance details unavailable.</p>
                                )}
                                {driverData && !driverLoading && (
                                    <VarianceDriverPanel data={driverData} />
                                )}
                            </div>
                        )}
                    </div>
                )}
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
