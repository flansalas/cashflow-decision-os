// ui/ForecastBanner.tsx – Top banner with run-out warnings + zone boundary
"use client";

import { AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";

interface Props {
    expectedRunOutWeek: number | null;
    worstCaseRunOutWeek: number | null;
    lowestExpected: number;
    lowestWorst: number;
    zoneBoundary: string;
    weeks: Array<{ weekNumber: number; weekEnd: string }>;
    onDrillIn?: () => void;
}

function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ForecastBanner({
    expectedRunOutWeek, worstCaseRunOutWeek,
    lowestExpected, lowestWorst, zoneBoundary, weeks, onDrillIn
}: Props) {
    const expectedDate = expectedRunOutWeek ? fmtDate(weeks[expectedRunOutWeek - 1].weekEnd) : "";
    const worstDate = worstCaseRunOutWeek ? fmtDate(weeks[worstCaseRunOutWeek - 1].weekEnd) : "";

    const isExpectedSafe = expectedRunOutWeek === null;
    const isWorstSafe = worstCaseRunOutWeek === null;

    const status = (isExpectedSafe && isWorstSafe) ? "STABLE" : isExpectedSafe ? "VULNERABLE" : "CRITICAL";

    let headline: string;
    let subtext: string | null = null;
    let statusColor: string;
    let badgeColor: string;
    let icon;

    if (status === "CRITICAL") {
        statusColor = "text-rose-700";
        badgeColor = "bg-rose-50 border-rose-100 text-rose-600";
        headline = `Potential Gap: Week ${expectedRunOutWeek}`;
        subtext = `Cash depletion by ${expectedDate}. Action recommended.`;
        icon = <AlertTriangle className="w-3.5 h-3.5" />;
    } else if (status === "VULNERABLE") {
        statusColor = "text-amber-700";
        badgeColor = "bg-amber-50 border-amber-100 text-amber-600";
        headline = `Limited Run-Out: Week ${worstCaseRunOutWeek}`;
        subtext = `Possible shortfall by ${worstDate}. Monitor risks.`;
        icon = <AlertTriangle className="w-3.5 h-3.5" />;
    } else {
        statusColor = "text-slate-800";
        badgeColor = "bg-slate-50 border-slate-100 text-slate-500";
        headline = "Operational Health";
        subtext = "Full stability confirmed.";
        icon = <CheckCircle2 className="w-3.5 h-3.5" />;
    }

    return (
        <div className={`rounded-2xl p-6 border shadow-sm transition-all view-enter overflow-hidden ${status === "STABLE" ? "bg-slate-50/50 border-slate-100" : status === "VULNERABLE" ? "bg-amber-50/50 border-amber-100" : "bg-rose-50/50 border-rose-100"}`}>
            <div className="flex flex-col gap-5">
                {/* Header & Status */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <div className={`text-[8px] font-black uppercase tracking-[0.2em] px-2 py-0.5 rounded-lg border flex items-center gap-1 ${badgeColor}`}>
                            {icon} {status}
                        </div>
                    </div>
                    <div>
                        <h2 className={`text-base font-bold tracking-tight ${statusColor}`}>{headline}</h2>
                        {subtext && (
                            <p className="text-xs font-medium text-slate-500 leading-snug mt-1">
                                {subtext}
                            </p>
                        )}
                    </div>
                    <div className="flex items-center gap-3 pt-1">
                         <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Layer: {zoneBoundary}</p>
                         {onDrillIn && status !== "STABLE" && (
                            <button onClick={onDrillIn} className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-900 hover:text-indigo-600 flex items-center gap-1 transition-colors">
                                Review <ArrowRight className="w-3 h-3" />
                            </button>
                         )}
                    </div>
                </div>

                {/* Scoreboard: Compact Grid for Sidebar */}
                <div className="flex items-center gap-4 border-t pt-4 border-slate-100">
                    <div className="flex-1">
                        <p className="text-[8px] uppercase font-bold tracking-[0.2em] text-slate-400 mb-0.5">Lowest Expected</p>
                        <p className={`text-xl font-bold font-financial tracking-tight ${lowestExpected < 0 ? "text-rose-600" : "text-slate-900"}`}>
                            {fmt(lowestExpected)}
                        </p>
                    </div>
                    <div className="w-px h-8 bg-slate-100" />
                    <div className="flex-1">
                        <p className="text-[8px] uppercase font-bold tracking-[0.2em] text-slate-400 mb-0.5">Conservative</p>
                        <p className={`text-xl font-bold font-financial tracking-tight ${lowestWorst < 0 ? "text-rose-500" : "text-slate-400"}`}>
                            {fmt(lowestWorst)}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
