import { useState } from "react";
import { CheckCircle2, AlertTriangle, FileText, ExternalLink } from "lucide-react";

function fmt(n: number | null | undefined) {
    if (n === null || n === undefined) return "-";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

export function CommittedActionsReview({ actions, customerObservations, vendorObservations }: { actions: any[], customerObservations: any[], vendorObservations: any[] }) {
    if (!actions || actions.length === 0) return null;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-8">
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-slate-800 text-sm">Committed Actions Review</h3>
            </div>
            <div className="divide-y divide-slate-100">
                {actions.map(action => (
                    <ActionReviewRow
                        key={action.id}
                        action={action}
                        customerObservations={customerObservations}
                        vendorObservations={vendorObservations}
                    />
                ))}
            </div>
        </div>
    );
}

function ActionReviewRow({ action, customerObservations, vendorObservations }: { action: any, customerObservations: any[], vendorObservations: any[] }) {
    const [status, setStatus] = useState(action.status || "planned");
    const [completionNote, setCompletionNote] = useState(action.completionNote || "");
    const [actualEffect, setActualEffect] = useState<string>(action.actualAmountImpact !== null ? String(action.actualAmountImpact) : "");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isCustomer = action.targetType === "invoice";
    const observations = isCustomer
        ? customerObservations.filter(o => o.invoiceId === action.targetId)
        : vendorObservations.filter(o => o.billId === action.targetId);

    const handleSave = async () => {
        setSaving(true);
        setError(null);
        try {
            const parsedActual = actualEffect.trim() === "" ? null : parseFloat(actualEffect);
            const res = await fetch(`/api/action-items/${action.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    status,
                    completionNote,
                    actualAmountImpact: parsedActual
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to update action");
        } catch (e: any) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    let statusLabel = "Planned";
    if (status === "missed") statusLabel = "Missed";
    if (status === "cancelled") statusLabel = "Cancelled";
    if (status === "completed") {
        if (actualEffect.trim() === "") statusLabel = "Completed — effect unverified";
        else statusLabel = "Completed — effect verified";
    }

    return (
        <div className="p-6 flex flex-col md:flex-row gap-6 hover:bg-slate-50 transition-colors">
            <div className="flex-1 space-y-2">
                <div className="flex items-start justify-between">
                    <div>
                        <h4 className="font-semibold text-slate-900 text-sm">{action.title}</h4>
                        <p className="text-xs text-slate-500 mt-0.5">{action.ownerName} • Due: {new Date(action.dueDate).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                        <div className="text-xs text-slate-500 font-medium">Expected Effect</div>
                        <div className={`text-sm font-bold font-financial ${action.amountImpact < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {action.amountImpact > 0 ? "+" : ""}{fmt(action.amountImpact)}
                        </div>
                    </div>
                </div>

                {observations.length > 0 && (
                    <div className="bg-blue-50/50 border border-blue-100 rounded-lg p-3 mt-3">
                        <div className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Evidence: Linked Payment Observations
                        </div>
                        {observations.map((obs: any, i: number) => (
                            <div key={i} className="flex items-center justify-between text-xs text-blue-900 bg-white border border-blue-100 rounded px-2 py-1.5 mb-1 last:mb-0">
                                <div>
                                    <span className="font-medium">{obs.paymentSource}</span> on {new Date(obs.actualPaymentDate).toLocaleDateString()}
                                </div>
                                <div className="font-financial font-medium">{fmt(obs.amount)}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex-1 bg-white border border-slate-200 rounded-lg p-4 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700">Status</label>
                    <span className="text-xs font-medium text-slate-500">{statusLabel}</span>
                </div>
                <select
                    value={status}
                    onChange={e => setStatus(e.target.value)}
                    className="w-full text-sm border-slate-200 rounded-md shadow-sm"
                >
                    <option value="planned">Planned</option>
                    <option value="completed">Completed</option>
                    <option value="missed">Missed</option>
                    <option value="cancelled">Cancelled</option>
                </select>

                <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700">Completion Note</label>
                    <textarea
                        value={completionNote}
                        onChange={e => setCompletionNote(e.target.value)}
                        placeholder="Add a note..."
                        className="w-full text-sm border-slate-200 rounded-md shadow-sm"
                        rows={2}
                    />
                </div>

                {status === "completed" && (
                    <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-700">Verified Actual Effect ($)</label>
                        <input
                            type="number"
                            value={actualEffect}
                            onChange={e => setActualEffect(e.target.value)}
                            placeholder="Leave empty if unverified"
                            className="w-full text-sm border-slate-200 rounded-md shadow-sm font-financial"
                        />
                    </div>
                )}

                <div className="flex items-center justify-between pt-2">
                    <div className="text-xs text-red-600 font-medium">{error}</div>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded shadow-sm hover:bg-slate-800 disabled:opacity-50"
                    >
                        {saving ? "Saving..." : "Save Outcome"}
                    </button>
                </div>
            </div>
        </div>
    );
}
