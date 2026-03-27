// ui/ForecastActionsView.tsx
// "Actions" view — adaptive-density week cards.
// Safe weeks: compact emoji + sentence + tank bar.
// Tight weeks: medium — adds contextual drill-in link.
// Danger/Critical weeks: full — inline reschedule buttons, no modal needed.
// Zero financial jargon. Plain language only.
"use client";

import { useState } from "react";
import type { ScenarioItem } from "./ScenarioBuilder";

// ── Shared types ──────────────────────────────────────────────────────────────
interface BreakdownItem {
    label: string;
    amount: number;
    type: string;
    sourceType: string;
    sourceId?: string;
    confidence: string;
}

interface WeekData {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    startCash: number;
    inflowsExpected: number;
    outflowsExpected: number;
    endCashExpected: number;
    endCashBest: number;
    endCashWorst: number;
    zone: string;
    breakdown: {
        inflows: BreakdownItem[];
        outflows: BreakdownItem[];
    };
    worstCaseDriver: string | null;
}

interface Props {
    weeks: WeekData[];
    buffer: number;
    constraintWeek: number | null;
    scenarioItems?: ScenarioItem[];
    companyId: string;
    onWeekClick?: (weekNumber: number) => void;
    /** Called after a successful inline override — should refresh the dashboard */
    onActioned: () => void;
}

import { Banknote, CheckCircle, AlertCircle, ShieldAlert, Skull, CreditCard, Calendar, AlertTriangle, Check, ArrowUpRight, ArrowDownRight } from "lucide-react";

type HealthStatus = "great" | "fine" | "tight" | "danger" | "critical";

function getHealth(endCash: number, buffer: number): HealthStatus {
    if (endCash >= buffer * 2) return "great";
    if (endCash >= buffer) return "fine";
    if (endCash >= buffer * 0.5) return "tight";
    if (endCash >= 0) return "danger";
    return "critical";
}

const HEALTH_META: Record<
    HealthStatus,
    { icon: React.ReactNode; bgStyle: React.CSSProperties; borderStyle: React.CSSProperties; tankColor: string; textColor: string }
> = {
    great: {
        icon: <Banknote className="w-5 h-5" />,
        bgStyle: { background: "rgba(16, 185, 129, 0.08)" },
        borderStyle: { borderColor: "rgba(16, 185, 129, 0.20)" },
        tankColor: "bg-emerald-500",
        textColor: "text-emerald-700",
    },
    fine: {
        icon: <CheckCircle className="w-5 h-5" />,
        bgStyle: { background: "var(--bg-raised)" },
        borderStyle: { borderColor: "var(--border-subtle)" },
        tankColor: "bg-emerald-400",
        textColor: "text-slate-500",
    },
    tight: {
        icon: <AlertCircle className="w-5 h-5" />,
        bgStyle: { background: "rgba(245, 158, 11, 0.08)" },
        borderStyle: { borderColor: "rgba(245, 158, 11, 0.20)" },
        tankColor: "bg-amber-400",
        textColor: "text-amber-700",
    },
    danger: {
        icon: <ShieldAlert className="w-5 h-5" />,
        bgStyle: { background: "rgba(239, 68, 68, 0.08)" },
        borderStyle: { borderColor: "rgba(239, 68, 68, 0.25)" },
        tankColor: "bg-red-500",
        textColor: "text-red-700",
    },
    critical: {
        icon: <Skull className="w-5 h-5" />,
        bgStyle: { background: "var(--bg-raised)" },
        borderStyle: { borderColor: "var(--border-strong)" },
        tankColor: "bg-gray-500",
        textColor: "text-gray-700",
    },
};

function fmtSimple(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return "$" + (abs / 1_000_000).toFixed(1) + "M";
    if (abs >= 10_000) return "$" + Math.round(abs / 1_000) + "k";
    if (abs >= 1_000) return "$" + (abs / 1_000).toFixed(1) + "k";
    return "$" + Math.round(abs);
}

function truncate(s: string, n = 24): string {
    return s.length > n ? s.slice(0, n) + "…" : s;
}

function getPlainSentence(h: HealthStatus, endCash: number, buffer: number): string {
    switch (h) {
        case "great":
            return `Doing great · ${fmtSimple(endCash)} in the bank`;
        case "fine":
            return `You're fine · ${fmtSimple(endCash)} left`;
        case "tight":
            return `Getting tight · ${fmtSimple(endCash - buffer)} above your safety net`;
        case "danger":
            return `${fmtSimple(buffer - endCash)} below your safety net`;
        case "critical":
            return `You'll run out of money`;
    }
}

// ── Inline action button ──────────────────────────────────────────────────────
function InlineAction({
    label,
    icon,
    companyId,
    overrideType,
    targetType,
    targetId,
    effectiveDate,
    colorClass,
    onDone,
}: {
    label: string;
    icon: React.ReactNode;
    companyId: string;
    overrideType: string;
    targetType: string;
    targetId: string;
    effectiveDate: string;
    colorClass: string;
    onDone: () => void;
}) {
    const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

    const fire = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (status !== "idle" && status !== "error") return;
        setStatus("loading");
        try {
            const res = await fetch("/api/overrides", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, type: overrideType, targetType, targetId, effectiveDate }),
            });
            if (res.ok) {
                setStatus("done");
                setTimeout(onDone, 600); // brief pause so user sees the tick
            } else {
                setStatus("error");
            }
        } catch {
            setStatus("error");
        }
    };

    if (status === "done") {
        return (
            <p className="text-xs text-emerald-400 font-semibold py-1.5 px-3 flex items-center gap-1.5">
                <Check className="w-3 h-3" /> Done — updating forecast…
            </p>
        );
    }

    return (
        <button
            onClick={fire}
            disabled={status === "loading"}
            className={`w-full text-left text-xs px-2.5 py-1.5 rounded-lg border font-semibold leading-snug disabled:opacity-40 active:scale-95 ${colorClass}`}
        >
            <span className="inline-block align-middle mr-1.5">{icon}</span>
            {status === "loading"
                ? "Saving…"
                : status === "error"
                    ? " Failed — tap to retry"
                    : label}
        </button>
    );
}

// ── Single week card ──────────────────────────────────────────────────────────
function WeekCard({
    week,
    buffer,
    companyId,
    isCurrentWeek,
    isConstraint,
    onWeekClick,
    onActioned,
}: {
    week: WeekData;
    buffer: number;
    companyId: string;
    isCurrentWeek: boolean;
    isConstraint: boolean;
    onWeekClick: (n: number) => void;
    onActioned: () => void;
}) {
    const health = getHealth(week.endCashExpected, buffer);
    const meta = HEALTH_META[health];
    const fuel = Math.max(0, Math.min(1, week.endCashExpected / (buffer * 2)));

    const isActionable = health === "danger" || health === "critical";
    const isTight = health === "tight";

    // Top AR inflow available to collect (has sourceId, can be rescheduled)
    const topAR = isActionable
        ? week.breakdown.inflows
            .filter(i => i.sourceType === "invoice" && !!i.sourceId)
            .sort((a, b) => b.amount - a.amount)[0]
        : null;

    // Top AP bill available to push (has sourceId)
    const topAP = isActionable
        ? week.breakdown.outflows
            .filter(i => i.sourceType === "bill" && !!i.sourceId)
            .sort((a, b) => b.amount - a.amount)[0]
        : null;

    // "Push to next week" = weekEnd + 7 days
    const nextWeekDate = new Date(week.weekEnd);
    nextWeekDate.setDate(nextWeekDate.getDate() + 7);
    const nextWeekStr = nextWeekDate.toISOString().split("T")[0];

    const dateStr = new Date(week.weekEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" });

    return (
        <div
            role="button"
            onClick={() => onWeekClick(week.weekNumber)}
            className={[
                "rounded-xl border p-2.5 flex flex-col gap-2 cursor-pointer select-none hover:brightness-110 active:scale-[0.98]",
                isCurrentWeek && !isConstraint ? "ring-2 ring-blue-400 ring-offset-1 ring-offset-black" : "",
                isConstraint ? "ring-2 ring-red-500 ring-offset-1 ring-offset-black" : "",
            ].join(" ")}
            style={{ ...meta.bgStyle, ...meta.borderStyle }}
        >
            {/* Week label row */}
            <div className="flex items-center justify-between">
                <div>
                    <span className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>W{week.weekNumber}</span>
                    {isCurrentWeek && (
                        <span className="ml-1 text-[8px] text-blue-400 font-bold">NOW</span>
                    )}
                    <p className="text-[8px]" style={{ color: "var(--text-faint)" }}>{dateStr}</p>
                </div>
                <span className="shrink-0" style={{ color: meta.tankColor.replace('bg-', 'text-').replace('400', '500') }}>
                    {meta.icon}
                </span>
            </div>

            {/* Plain language sentence */}
            <p className={`text-xs font-semibold leading-tight ${meta.textColor}`}>
                {getPlainSentence(health, week.endCashExpected, buffer)}
            </p>

            {/* Tank bar */}
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
                <div className={`h-full rounded-full ${meta.tankColor}`} style={{ width: `${fuel * 100}%` }} />
            </div>

            {/* Tight: one contextual link */}
            {isTight && (
                <p className="text-[11px] text-amber-400/80 hover:text-amber-300 underline underline-offset-2 leading-tight"
                    onClick={e => { e.stopPropagation(); onWeekClick(week.weekNumber); }}>
                    See what’s landing →
                </p>
            )}

            {/* Actionable: inline fix buttons */}
            {isActionable && (
                <div className="space-y-1 mt-0.5" onClick={e => e.stopPropagation()}>
                    {topAR && (
                        <InlineAction
                            label={`Collect: ${truncate(topAR.label)} (+${fmtSimple(topAR.amount)})`}
                            icon={<CreditCard className="w-3 h-3" />}
                            companyId={companyId}
                            overrideType="set_expected_payment_date"
                            targetType="invoice"
                            targetId={topAR.sourceId!}
                            effectiveDate={week.weekStart}
                            colorClass="border-emerald-700/40 text-emerald-300 hover:bg-emerald-950/60"
                            onDone={onActioned}
                        />
                    )}
                    {topAP && (
                        <InlineAction
                            label={`Push bill: ${truncate(topAP.label)} (${fmtSimple(topAP.amount)})`}
                            icon={<Calendar className="w-3 h-3" />}
                            companyId={companyId}
                            overrideType="set_bill_due_date"
                            targetType="bill"
                            targetId={topAP.sourceId!}
                            effectiveDate={nextWeekStr}
                            colorClass="border-red-700/40 text-red-300 hover:bg-red-950/60"
                            onDone={onActioned}
                        />
                    )}
                    {!topAR && !topAP && (
                        <p className="text-[11px] italic" style={{ color: "var(--text-faint)" }}>
                            No quick fixes — tap for details
                        </p>
                    )}
                </div>
            )}

            {/* Constraint callout */}
            {isConstraint && (
                <p className="text-[8px] text-red-400 font-bold flex items-center gap-1">
                    <AlertTriangle className="w-2.5 h-2.5" /> EARLIEST PROBLEM
                </p>
            )}
        </div>
    );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export function ForecastActionsView({
    weeks,
    buffer,
    constraintWeek,
    scenarioItems = [],
    companyId,
    onWeekClick,
    onActioned,
}: Props) {
    // Determine which week is "now"
    const today = new Date();
    const currentWeekNumber =
        weeks.find(w => {
            const s = new Date(w.weekStart);
            const e = new Date(w.weekEnd);
            return today >= s && today <= e;
        })?.weekNumber ?? null;

    // Summary stats
    const attentionWeeks = weeks.filter(w => {
        const h = getHealth(w.endCashExpected, buffer);
        return h === "tight" || h === "danger" || h === "critical";
    });

    const quickFixWeeks = weeks.filter(w => {
        const h = getHealth(w.endCashExpected, buffer);
        if (h !== "danger" && h !== "critical") return false;
        const hasAR = w.breakdown.inflows.some(i => i.sourceType === "invoice" && !!i.sourceId);
        const hasAP = w.breakdown.outflows.some(i => i.sourceType === "bill" && !!i.sourceId);
        return hasAR || hasAP;
    });

    const allGood = attentionWeeks.length === 0;

    return (
        <div className="flex-1 flex flex-col w-full relative min-h-0">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
                <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        13-Week Actions
                    </h3>
                    <p className="text-[10px] mt-0.5 text-slate-400/80">
                        Problem weeks show instant fixes · click any card for full breakdown
                    </p>
                </div>
                {/* Summary pill */}
                <div className="text-right shrink-0 ml-4">
                    {allGood ? (
                        <p className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                            <CheckCircle className="w-4 h-4" /> All 13 weeks look good
                        </p>
                    ) : (
                        <>
                            <p className="text-sm font-bold text-red-400">
                                {attentionWeeks.length} week{attentionWeeks.length !== 1 ? "s" : ""} need attention
                            </p>
                            {quickFixWeeks.length > 0 && (
                                <p className="text-xs text-emerald-400">
                                    {quickFixWeeks.length} have quick fixes
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* 13 cards in a 7-column grid */}
            <div className="grid grid-cols-7 gap-3 flex-1 overflow-y-auto min-h-0 items-start">
                {weeks.map(w => (
                    <WeekCard
                        key={w.weekNumber}
                        week={w}
                        buffer={buffer}
                        companyId={companyId}
                        isCurrentWeek={w.weekNumber === currentWeekNumber}
                        isConstraint={w.weekNumber === constraintWeek}
                        onWeekClick={onWeekClick ?? (() => { })}
                        onActioned={onActioned}
                    />
                ))}
            </div>

            {/* Legend */}
            <div className="mt-4 pt-4 border-t flex flex-wrap gap-x-4 gap-y-2 text-[11px] shrink-0" style={{ borderColor: "var(--border-subtle)", color: "var(--text-faint)" }}>
                <span className="flex items-center gap-1"><Banknote className="w-3 h-3" /> Great</span>
                <span className="flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Fine</span>
                <span className="flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Tight</span>
                <span className="flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> Below net</span>
                <span className="flex items-center gap-1"><Skull className="w-3 h-3" /> Out of cash</span>
                <span className="ml-auto">Tank = % of 2× safety net</span>
            </div>
        </div>
    );
}
