// ui/OnboardingWizard.tsx – Express 3-step onboarding wizard + optional uploads
// Step 0: Company Name
// Step 1: Opening Cash (bank balance + inline adjustments + live Spendable Cash preview)
// Step 2: Payroll (auto-sets buffer = 1× payroll, auto-completes onboarding)
// Step 3: Upload AR/AP (optional)
// Step 4: Upload Bank (optional)
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ARAPUploadStep } from "@/ui/ARAPUploadStep";
import { BankUploadStep } from "@/ui/BankUploadStep";
import { Landmark, Users, Building2, CheckCircle2, FolderOpen, ArrowRight, ArrowLeft, X, ChevronDown, Sparkles } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdjustmentRow {
    amount: string;
    note: string;
}

interface Props {
    companyId?: string;        // provided when resuming
    startStep?: number;        // 0-based step to resume at
    onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
    return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

const STEPS = [
    { label: "Opening Cash", icon: <Landmark className="w-4 h-4" /> },
    { label: "Payroll", icon: <Users className="w-4 h-4" /> },
    { label: "Upload AR/AP", icon: <FolderOpen className="w-4 h-4" />, optional: true },
    { label: "Upload Bank", icon: <Landmark className="w-4 h-4" />, optional: true },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
    return <label className="block text-sm font-medium mb-1" style={{ color: "var(--text-primary)" }}>{children}</label>;
}

function TextInput({ value, onChange, placeholder, type = "text", min, step, prefix }: {
    value: string; onChange: (v: string) => void; placeholder?: string;
    type?: string; min?: string; step?: string; prefix?: React.ReactNode;
}) {
    return (
        <div className="relative">
            {prefix && (
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm pointer-events-none transition-colors" style={{ color: "var(--text-faint)" }}>{prefix}</span>
            )}
            <input
                type={type}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
                min={min}
                step={step}
                className={`w-full border rounded-xl py-2.5 text-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 ${prefix ? "pl-8 pr-3" : "px-4"}`}
                style={{ background: "var(--bg-input)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
            />
        </div>
    );
}

function SelectInput({ value, onChange, options }: {
    value: string; onChange: (v: string) => void;
    options: { value: string; label: string }[];
}) {
    return (
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full border rounded-xl px-4 py-2.5 text-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M5%207L10%2012L15%207%22%20stroke%3D%22%2364748B%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3C/svg%3E')] bg-[length:20px_20px] bg-no-repeat bg-[right_12px_center]"
            style={{ background: "var(--bg-input)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
        >
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
}

function ErrorBox({ msg }: { msg: string }) {
    return (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {msg}
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function OnboardingWizard({ companyId: initialCompanyId, startStep = 0, onClose }: Props) {
    const router = useRouter();
    const [step, setStep] = useState(startStep);
    const [companyId, setCompanyId] = useState(initialCompanyId ?? "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ── Step 0 – Company Name ──────────────────────────────────────────────────
    const [companyName, setCompanyName] = useState("My Company");

    // ── Step 1 – Opening Cash ──────────────────────────────────────────────────
    const [bankBalance, setBankBalance] = useState("");
    const [asOfDate, setAsOfDate] = useState(today());
    const [showAdjustments, setShowAdjustments] = useState(false);
    const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([
        { amount: "", note: "" },
    ]);

    // ── Step 2 – Payroll ───────────────────────────────────────────────────────
    const [payrollCadence, setPayrollCadence] = useState<"weekly" | "biweekly" | "monthly">("biweekly");
    const [payrollAmount, setPayrollAmount] = useState("");
    const [payrollNextDate, setPayrollNextDate] = useState("");

    // Computed adjusted cash (live preview)
    const bankBalNum = parseFloat(bankBalance) || 0;
    const adjTotal = adjustments.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);
    const adjustedCash = bankBalNum + adjTotal;

    // ── Shared post helper ────────────────────────────────────────────────────
    async function post(url: string, body: object): Promise<boolean> {
        setSaving(true);
        setError(null);
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.error ?? "Save failed");
                return false;
            }
            return true;
        } catch {
            setError("Network error — try again");
            return false;
        } finally {
            setSaving(false);
        }
    }

    // ── Step handlers ─────────────────────────────────────────────────────────

    async function handleStartCompany() {
        const res = await fetch("/api/onboarding/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: companyName }),
        });
        const data = await res.json();
        if (!res.ok || !data.companyId) { setError(data.error ?? "Failed to create company"); return; }
        const cid = data.companyId;
        setCompanyId(cid);
        localStorage.setItem("cfdo_company_id", cid);
        // If resuming an incomplete onboarding, map old steps to new ones
        if (data.resumed && data.onboardingStep > 0) {
            // Old steps 1-5 all map to our new step 1 or 2
            if (data.onboardingStep >= 2) {
                setStep(2); // Jump to payroll if cash was already saved
            } else {
                setStep(1);
            }
        } else {
            setStep(1);
        }
    }

    async function handleSaveCash() {
        if (!bankBalance || parseFloat(bankBalance) === 0) {
            setError("Bank balance is required"); return;
        }
        const validAdj = adjustments.filter(a => a.amount !== "" && parseFloat(a.amount) !== 0);
        const ok = await post("/api/onboarding/cash", {
            companyId,
            bankBalance: parseFloat(bankBalance),
            asOfDate,
            adjustments: validAdj.map(a => ({
                amount: parseFloat(a.amount),
                note: a.note || null,
            })),
        });
        if (ok) setStep(2);
    }

    async function handleSavePayrollAndComplete() {
        if (!payrollAmount || parseFloat(payrollAmount) <= 0) {
            setError("Payroll amount is required"); return;
        }
        if (!payrollNextDate) { setError("Next pay date is required"); return; }

        setSaving(true);
        setError(null);

        try {
            // 1. Save payroll
            const payRes = await fetch("/api/onboarding/payroll", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    cadence: payrollCadence,
                    allInAmount: parseFloat(payrollAmount),
                    nextDate: payrollNextDate,
                }),
            });
            const payData = await payRes.json();
            if (!payRes.ok) { setError(payData.error ?? "Failed to save payroll"); return; }

            // 2. Auto-set buffer = 1× payroll
            const bufferVal = parseFloat(payrollAmount);
            const bufRes = await fetch("/api/onboarding/buffer", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, bufferMin: bufferVal }),
            });
            if (!bufRes.ok) {
                // Non-critical — continue even if buffer save fails
                console.warn("Buffer auto-set failed, continuing...");
            }

            // 3. Mark onboarding complete
            const compRes = await fetch("/api/onboarding/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, mismatchUnreconciled: false }),
            });
            if (!compRes.ok) { setError("Failed to complete setup"); return; }

            // Success → go to optional upload step
            setStep(3);
        } catch {
            setError("Network error — try again");
        } finally {
            setSaving(false);
        }
    }

    function addAdjustmentRow() {
        if (adjustments.length < 5) setAdjustments(a => [...a, { amount: "", note: "" }]);
    }
    function removeAdjustmentRow(i: number) {
        setAdjustments(a => a.filter((_, idx) => idx !== i));
    }

    // ── Render ─────────────────────────────────────────────────────────────────

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(15, 23, 42, 0.4)", backdropFilter: "blur(8px)" }}>
            <div className="border rounded-2xl w-full max-w-xl max-h-[92vh] flex flex-col shadow-2xl relative overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
                {/* Header + stepper */}
                <div className="shrink-0 border-b px-6 py-5" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Set Up Your Company</h2>
                        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl border hover:bg-slate-50 transition-all active:scale-95" style={{ color: "var(--text-muted)", borderColor: "var(--border-subtle)", background: "var(--bg-raised)" }}>
                            <X className="w-4.5 h-4.5" />
                        </button>
                    </div>
                    {/* Stepper dots — only show for steps 1+ */}
                    {step >= 1 && step <= 2 && (
                        <div className="flex gap-1.5 items-center flex-wrap">
                            {STEPS.slice(0, 2).map((s, i) => (
                                <div key={i} className="flex items-center gap-1.5">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold transition-all duration-300 shadow-sm
                                        ${i + 1 < step ? "bg-emerald-600 text-white"
                                            : i + 1 === step ? "bg-slate-900 text-white ring-4 ring-slate-900/10"
                                                : "text-slate-400 bg-slate-50 border border-slate-200"
                                        }`}
                                    >
                                        {i + 1 < step ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
                                    </div>
                                    {i < 1 && (
                                        <div className={`h-0.5 w-6 rounded ${i + 1 < step ? "bg-emerald-600" : ""}`} style={i + 1 >= step ? { background: "var(--bg-input)" } : {}} />
                                    )}
                                </div>
                            ))}
                            <span className="text-xs ml-2" style={{ color: "var(--text-muted)" }}>
                                {STEPS[step - 1]?.icon} {STEPS[step - 1]?.label}
                            </span>
                            <span className="text-xs ml-auto" style={{ color: "var(--text-faint)" }}>
                                Step {step} of 2
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 custom-scrollbar">
                    {error && <ErrorBox msg={error} />}

                    {/* ── Step 0: Company name ─────────────────────────────────────── */}
                    {step === 0 && (
                        <>
                            <div className="text-center space-y-2 mb-2">
                                <h3 className="text-lg font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>Welcome to Your Financial Command Deck</h3>
                                <p className="text-sm" style={{ color: "var(--text-muted)" }}>Just 2 minutes away from your first 13-week cash forecast.</p>
                            </div>
                            <div>
                                <FieldLabel>Company name</FieldLabel>
                                <TextInput value={companyName} onChange={setCompanyName} placeholder="Apex Mechanical Services" />
                            </div>
                            <button
                                onClick={handleStartCompany}
                                disabled={saving}
                                className="w-full py-3.5 text-white font-bold rounded-xl transition-all shadow-lg shadow-slate-900/20 active:scale-[0.98] disabled:opacity-50"
                                style={{ background: "var(--color-primary)" }}
                            >
                                {saving ? "Configuring..." : <span className="flex items-center justify-center gap-2">Initialize Forecast <ArrowRight className="w-4 h-4" /></span>}
                            </button>
                        </>
                    )}

                    {/* ── Step 1: Opening Cash ─────────────────────────────────────── */}
                    {step === 1 && (
                        <>
                            <div>
                                <h3 className="text-base font-bold mb-1 flex items-center gap-2" style={{ color: "var(--text-primary)" }}><Landmark className="w-5 h-5" /> What&apos;s in the bank right now?</h3>
                                <p className="text-sm" style={{ color: "var(--text-muted)" }}>Grab your most recent online banking balance. This is your starting point.</p>
                            </div>
                            <div>
                                <FieldLabel>Bank balance</FieldLabel>
                                <TextInput type="number" value={bankBalance} onChange={setBankBalance} placeholder="0.00" min="0" step="100" prefix="$" />
                            </div>
                            <div>
                                <FieldLabel>As of date</FieldLabel>
                                <TextInput type="date" value={asOfDate} onChange={setAsOfDate} />
                            </div>

                            {/* Collapsible adjustments */}
                            <div>
                                <button
                                    onClick={() => setShowAdjustments(!showAdjustments)}
                                    className="flex items-center gap-2 text-xs font-semibold transition-colors hover:opacity-80"
                                    style={{ color: "var(--text-muted)" }}
                                >
                                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdjustments ? "rotate-180" : ""}`} />
                                    Any outstanding checks or pending deposits?
                                    <span className="text-xs font-normal" style={{ color: "var(--text-faint)" }}>(optional)</span>
                                </button>

                                {showAdjustments && (
                                    <div className="mt-3 rounded-xl border p-4 space-y-3" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                                        <p className="text-xs" style={{ color: "var(--text-faint)" }}>Enter amounts that make your bank balance different from reality. Use negative numbers for outstanding checks.</p>
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium" style={{ color: "var(--text-secondary)" }}>Adjustments</span>
                                            <button onClick={addAdjustmentRow} disabled={adjustments.length >= 5} className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-40">+ Add row</button>
                                        </div>
                                        {adjustments.map((adj, i) => (
                                            <div key={i} className="flex gap-2">
                                                <div className="w-32 shrink-0">
                                                    <input
                                                        type="number"
                                                        value={adj.amount}
                                                        onChange={e => setAdjustments(a => a.map((r, idx) => idx === i ? { ...r, amount: e.target.value } : r))}
                                                        placeholder="e.g. -5000"
                                                        step="100"
                                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                                                        style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                                                    />
                                                </div>
                                                <div className="flex-1">
                                                    <input
                                                        type="text"
                                                        value={adj.note}
                                                        onChange={e => setAdjustments(a => a.map((r, idx) => idx === i ? { ...r, note: e.target.value } : r))}
                                                        placeholder="Note (e.g. outstanding check)"
                                                        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                                                        style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                                                    />
                                                </div>
                                                {adjustments.length > 1 && (
                                                    <button onClick={() => removeAdjustmentRow(i)} className="hover:text-red-400 px-1" style={{ color: "var(--text-muted)" }}>
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Live Spendable Cash Preview — the inline "Reality Check" */}
                            {bankBalNum > 0 && (
                                <div className="rounded-xl border p-4" style={{ background: "rgba(5, 150, 105, 0.04)", borderColor: "rgba(5, 150, 105, 0.15)" }}>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-[10px] uppercase tracking-[0.2em] font-bold mb-1" style={{ color: "var(--text-muted)" }}>Verified Spendable Cash</p>
                                            <p className="text-3xl font-bold font-financial tracking-tight text-emerald-700">{fmt(adjustedCash)}</p>
                                        </div>
                                        {adjTotal !== 0 && (
                                            <div className="text-right">
                                                <p className="text-xs" style={{ color: "var(--text-faint)" }}>Bank: {fmt(bankBalNum)}</p>
                                                <p className="text-xs" style={{ color: adjTotal >= 0 ? "var(--text-faint)" : "var(--color-danger)" }}>
                                                    Adj: {adjTotal >= 0 ? "+" : ""}{fmt(adjTotal)}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                                        This is the real number your forecast starts from — not just what the bank says.
                                    </p>
                                </div>
                            )}

                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setStep(0)} className="px-4 py-2.5 rounded-xl text-sm transition-colors flex items-center gap-1" style={{ background: "var(--bg-raised)", color: "var(--text-secondary)" }}><ArrowLeft className="w-4 h-4" /> Back</button>
                                <button onClick={handleSaveCash} disabled={saving} className="flex-1 py-2.5 text-white font-semibold rounded-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2" style={{ background: "var(--color-primary)" }}>
                                    {saving ? "Saving…" : <>Save & Continue <ArrowRight className="w-4 h-4" /></>}
                                </button>
                            </div>
                        </>
                    )}

                    {/* ── Step 2: Payroll ───────────────────────────────────────────── */}
                    {step === 2 && (
                        <>
                            <div>
                                <h3 className="text-base font-bold mb-1 flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
                                    <Users className="w-5 h-5 text-slate-400" /> Last question — payroll
                                </h3>
                                <p className="text-sm" style={{ color: "var(--text-muted)" }}>Your biggest outflow. After this, you&apos;ll see your 13-week forecast instantly.</p>
                            </div>
                            <div>
                                <FieldLabel>Pay cadence</FieldLabel>
                                <SelectInput value={payrollCadence} onChange={v => setPayrollCadence(v as "weekly" | "biweekly" | "monthly")} options={[
                                    { value: "weekly", label: "Weekly" },
                                    { value: "biweekly", label: "Every 2 weeks (biweekly)" },
                                    { value: "monthly", label: "Monthly" },
                                ]} />
                            </div>
                            <div>
                                <FieldLabel>All-in payroll amount</FieldLabel>
                                <TextInput type="number" value={payrollAmount} onChange={setPayrollAmount} placeholder="0.00" min="0" step="100" prefix="$" />
                                <p className="text-xs mt-1" style={{ color: "var(--text-faint)" }}>Include salaries + employer taxes + benefits burden.</p>
                            </div>
                            <div>
                                <FieldLabel>Next pay date</FieldLabel>
                                <TextInput type="date" value={payrollNextDate} onChange={setPayrollNextDate} />
                            </div>

                            {/* Auto-buffer hint */}
                            {parseFloat(payrollAmount) > 0 && (
                                <div className="rounded-lg px-4 py-3 text-sm border flex items-start gap-2" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
                                    <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-blue-400" />
                                    <span>We&apos;ll auto-set your safety buffer to <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{fmt(parseFloat(payrollAmount))}</span> (1× payroll). You can adjust this anytime from the dashboard.</span>
                                </div>
                            )}

                            <div className="flex gap-3 pt-2">
                                <button onClick={() => setStep(1)} className="px-4 py-2.5 rounded-xl text-sm transition-colors flex items-center gap-1" style={{ background: "var(--bg-raised)", color: "var(--text-secondary)" }}><ArrowLeft className="w-4 h-4" /> Back</button>
                                <button onClick={handleSavePayrollAndComplete} disabled={saving} className="flex-1 py-3 text-white font-semibold rounded-xl transition-all disabled:opacity-50 text-sm flex items-center justify-center gap-2" style={{ background: "var(--color-primary)" }}>
                                    {saving ? "Setting up…" : <>See My Forecast <ArrowRight className="w-4 h-4" /></>}
                                </button>
                            </div>
                        </>
                    )}

                    {/* ── Step 3: Upload AR/AP (optional) ───────────────────────── */}
                    {step === 3 && companyId && (
                        <>
                            {/* Success celebration before uploads */}
                            <div className="text-center space-y-2 mb-2">
                                <div className="flex justify-center mb-1">
                                    <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center">
                                        <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                                    </div>
                                </div>
                                <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>Your forecast is ready!</h3>
                                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                                    Want to make it more accurate? Upload your invoices and bills below, or skip to your dashboard.
                                </p>
                                <button
                                    onClick={() => {
                                        onClose();
                                        router.push(`/dashboard?companyId=${companyId}`);
                                    }}
                                    className="text-sm font-semibold transition-colors hover:underline flex items-center justify-center gap-1 mx-auto"
                                    style={{ color: "var(--color-primary)" }}
                                >
                                    Skip — take me to the dashboard <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <ARAPUploadStep
                                companyId={companyId}
                                onDone={() => setStep(4)}
                            />
                        </>
                    )}
                    {/* ── Step 4: Upload Bank (optional) ───────────────────────── */}
                    {step === 4 && companyId && (
                        <>
                            <BankUploadStep
                                companyId={companyId}
                                onDone={() => {
                                    onClose();
                                    router.push(`/dashboard?companyId=${companyId}`);
                                }}
                            />
                        </>
                    )}

                </div>
            </div>
        </div>
    );
}
