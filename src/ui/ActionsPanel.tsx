// ui/ActionsPanel.tsx – Urgent Actions list — redesigned for Tactical Ledger aesthetic
"use client";
import { ArrowDownLeft, Clock, Scissors, PlusCircle, AlertTriangle, Pin, CheckCircle, ArrowRight } from "lucide-react";

interface Action {
    type: string;
    priority: string;
    title: string;
    description: string;
    amountImpact: number;
    impactCertainty: string;
    targetType: string;
    targetId: string | null;
}

interface Props {
    actions: Action[];
}

function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0 });
}

// Left-border color stripe per priority
const priorityStripe: Record<string, string> = {
    p1: "#e11d48", // Rose 600
    p2: "#d97706", // Amber 600
    p3: "#2563eb", // Blue 600
};

// Badge styling per priority
const priorityBadge: Record<string, string> = {
    p1: "text-red-400 bg-red-500/10 border border-red-500/25",
    p2: "text-amber-400 bg-amber-500/10 border border-amber-500/25",
    p3: "text-blue-400 bg-blue-500/10 border border-blue-500/25",
};

const certaintyBadge: Record<string, string> = {
    high: "text-emerald-700 bg-emerald-50 border border-emerald-100",
    med: "text-amber-700 bg-amber-50 border border-amber-100",
    low: "text-rose-700 bg-rose-50 border border-rose-100",
};

const typeIcons: Record<string, React.ReactNode> = {
    collect_ar: <ArrowDownLeft className="w-5 h-5 text-emerald-400" />,
    delay_ap: <Clock className="w-5 h-5 text-amber-400" />,
    reduce_outflows: <Scissors className="w-5 h-5 text-indigo-400" />,
    add_cash_adjustment: <PlusCircle className="w-5 h-5 text-blue-400" />,
    risk_alert: <AlertTriangle className="w-5 h-5 text-red-400" />,
    other: <Pin className="w-5 h-5 text-slate-400" />,
};

export function ActionsPanel({ actions }: Props) {
    return (
        <div className="rounded-xl border overflow-hidden" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
            <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-surface)" }}>
                <h3 className="text-[11px] font-bold uppercase tracking-[0.2em]" style={{ color: "var(--text-muted)" }}>
                    Survival Manuevers
                </h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full border" style={{
                    color: actions.length > 0 ? "#f87171" : "#34d399",
                    borderColor: actions.length > 0 ? "rgba(248,113,113,0.2)" : "rgba(52,211,153,0.2)",
                    background: actions.length > 0 ? "rgba(248,113,113,0.05)" : "rgba(52,211,153,0.05)",
                }}>
                    {actions.length} action{actions.length !== 1 ? "s" : ""}
                </span>
            </div>

            <div>
                {actions.length === 0 ? (
                    <div className="px-5 py-8 text-center">
                        <p className="text-sm flex items-center justify-center gap-2" style={{ color: "var(--text-muted)" }}>
                            No urgent actions — looking strong <CheckCircle className="w-4 h-4 text-emerald-500" />
                        </p>
                    </div>
                ) : (
                    actions.map((action, i) => (
                        <div
                            key={i}
                            className={`flex items-start gap-4 px-6 py-5 border-b last:border-0 transition-all stagger-item hover-elevate ${action.priority === "p1" ? "p1-pulse" : ""}`}
                            style={{
                                animationDelay: `${i * 60}ms`,
                                borderColor: "var(--border-subtle)",
                                borderLeft: `4px solid ${priorityStripe[action.priority] ?? "#475569"}`,
                            }}
                        >
                            <span className="mt-1 shrink-0">{typeIcons[action.type] || <Pin className="w-5 h-5 text-slate-400"/>}</span>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-black uppercase tracking-widest ${priorityBadge[action.priority]}`}>
                                        {action.priority.toUpperCase()}
                                    </span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tight ${certaintyBadge[action.impactCertainty]}`}>
                                        {action.impactCertainty} certainty
                                    </span>
                                </div>
                                <p className="text-sm font-bold text-white mb-0.5 group-hover:text-indigo-300 transition-colors uppercase tracking-tight">{action.title}</p>
                                <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>{action.description}</p>
                                
                                <div className="mt-4">
                                    <a 
                                        href={
                                            action.type === "collect_ar" ? `/cashflow?mode=ar&highlightId=${action.targetId}` :
                                            action.type === "delay_ap" ? `/cashflow?mode=ap&highlightId=${action.targetId}` :
                                            action.type === "reduce_outflows" ? `/recurring?highlightId=${action.targetId}` :
                                            action.type === "add_cash_adjustment" ? "/cash-adjustments" :
                                            "/cashflow"
                                        }
                                        className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest px-4 py-2 rounded-xl border shadow-sm hover:shadow-md hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all active:scale-95"
                                        style={{ color: "var(--text-primary)", borderColor: "var(--border-subtle)", background: "var(--bg-raised)" }}
                                    >
                                        Execute Action
                                        <ArrowRight className="w-3.5 h-3.5" />
                                    </a>
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <p className="text-base font-black font-financial text-emerald-400">+{fmt(action.amountImpact)}</p>
                                <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5" style={{ color: "var(--text-muted)" }}>impact</p>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
