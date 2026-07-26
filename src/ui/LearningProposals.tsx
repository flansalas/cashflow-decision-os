import { useState } from "react";
import { Lightbulb, Check, X } from "lucide-react";

export function LearningProposals({ proposals, onAction }: { proposals: any[], onAction: () => void }) {
    if (!proposals || proposals.length === 0) return null;

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-8">
            <div className="px-6 py-4 border-b border-slate-100 bg-amber-50/50 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-600" />
                <h3 className="font-bold text-slate-800 text-sm">Suggested Adjustments</h3>
            </div>
            <div className="divide-y divide-slate-100">
                {proposals.map(p => (
                    <ProposalRow key={p.id} proposal={p} onAction={onAction} />
                ))}
            </div>
        </div>
    );
}

function ProposalRow({ proposal, onAction }: { proposal: any, onAction: () => void }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    let change: any = {};
    try {
        change = JSON.parse(proposal.proposedChangeJson);
    } catch {}

    const handleVote = async (status: "approved" | "rejected") => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`/api/learning-proposals/${proposal.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to update proposal");
            onAction();
        } catch (e: any) {
            setError(e.message);
            setLoading(false);
        }
    };

    return (
        <div className="p-6 flex flex-col md:flex-row gap-6 hover:bg-slate-50 transition-colors">
            <div className="flex-1 space-y-2">
                <div className="font-semibold text-slate-900 text-sm">{proposal.rationale}</div>
                <div className="text-xs text-slate-600 mt-1">
                    Proposed Change: {change.field} <span className="font-medium">{(change.currentValue * 100).toFixed(0)}% &rarr; {(change.proposedValue * 100).toFixed(0)}%</span>
                </div>
                {error && <div className="text-xs text-red-600 font-medium">{error}</div>}
            </div>
            <div className="flex items-center gap-3">
                <button
                    onClick={() => handleVote("rejected")}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded text-sm font-medium transition-colors disabled:opacity-50"
                >
                    <X className="w-4 h-4" /> Reject
                </button>
                <button
                    onClick={() => handleVote("approved")}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-medium shadow-sm transition-colors disabled:opacity-50"
                >
                    <Check className="w-4 h-4" /> Approve
                </button>
            </div>
        </div>
    );
}
