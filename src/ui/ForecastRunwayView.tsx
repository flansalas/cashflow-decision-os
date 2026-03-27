// ui/ForecastRunwayView.tsx
// "Runway Strip" view — 13 week tiles, each showing health relative to the buffer.
// Key design principles:
//  - Distance from buffer (not absolute balance) drives tile color intensity
//  - Weeks 1-6 are wider (where decisions happen); 7-13 are narrower
//  - Fuel gauge bar inside each tile shows "tank level" visually
//  - No in/out mini numbers (noise) — one job per tile: safe or not?
"use client";

import type { ScenarioItem } from "./ScenarioBuilder";
import { Zap, ArrowUp, ArrowDown, AlertTriangle, Circle, Square } from "lucide-react";

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
}

interface Props {
    weeks: WeekData[];
    buffer: number;
    constraintWeek: number | null;
    scenarioItems?: ScenarioItem[];
    /** Map from weekNumber → change in endCashExpected since last visit (positive = improved) */
    forecastDiff?: Map<number, number>;
    onWeekClick?: (weekNumber: number) => void;
}

function fmtCompact(n: number): string {
    if (Math.abs(n) >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
    if (Math.abs(n) >= 1_000) return "$" + Math.round(n / 1_000) + "k";
    return "$" + Math.round(n);
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return (d.getMonth() + 1) + "/" + d.getDate();
}

type HealthStatus = "safe" | "warning" | "danger" | "critical";

function getStatus(endCash: number, buffer: number): HealthStatus {
    if (endCash < 0) return "critical";
    if (endCash < buffer) return "danger";
    if (endCash < buffer * 1.5) return "warning";
    return "safe";
}

/** Returns 0–1 representing "tank level": 0 = empty/negative, 1 = 2× buffer or above */
function fuelLevel(endCash: number, buffer: number): number {
    if (endCash <= 0) return 0;
    const maxFull = buffer * 2;
    return Math.min(1, endCash / maxFull);
}

interface TileStyleDef {
    borderStyle: (intensity: number) => React.CSSProperties;
    barFill: string;
    balanceColor: string;
    dot: string;
    bgStyle: (intensity: number) => React.CSSProperties;
}
import React from "react";

const TILE_STYLES: Record<HealthStatus, TileStyleDef> = {
    safe: {
        borderStyle: () => ({ borderColor: "rgba(16, 185, 129, 0.20)" }),
        barFill: "#059669",
        balanceColor: "text-emerald-700",
        dot: "#059669",
        bgStyle: () => ({ background: "rgba(16, 185, 129, 0.04)" }),
    },
    warning: {
        borderStyle: () => ({ borderColor: "rgba(217, 119, 6, 0.20)" }),
        barFill: "#d97706",
        balanceColor: "text-amber-700",
        dot: "#d97706",
        bgStyle: () => ({ background: "rgba(217, 119, 6, 0.04)" }),
    },
    danger: {
        borderStyle: () => ({ borderColor: "rgba(225, 29, 72, 0.25)" }),
        barFill: "#e11d48",
        balanceColor: "text-rose-700",
        dot: "#e11d48",
        bgStyle: () => ({ background: "rgba(225, 29, 72, 0.04)" }),
    },
    critical: {
        borderStyle: () => ({ borderColor: "var(--border-subtle)" }),
        barFill: "#1e293b",
        balanceColor: "text-slate-900",
        dot: "#1e293b",
        bgStyle: () => ({ background: "var(--bg-raised)" }),
    },
};

export function ForecastRunwayView({ weeks, buffer, constraintWeek, scenarioItems = [], forecastDiff = new Map(), onWeekClick }: Props) {
    const hasScenario = scenarioItems.length > 0;

    const scenarioDeltaByWeek = new Map<number, number>();
    for (const item of scenarioItems) {
        const existing = scenarioDeltaByWeek.get(item.weekNumber) ?? 0;
        const delta = item.direction === "in" ? item.amount : -item.amount;
        scenarioDeltaByWeek.set(item.weekNumber, existing + delta);
    }

    let runningScenarioCash = 0;
    const enriched = weeks.map(w => {
        const weekDelta = scenarioDeltaByWeek.get(w.weekNumber) ?? 0;
        runningScenarioCash += weekDelta;
        const scenarioEnd = hasScenario ? w.endCashExpected + runningScenarioCash : null;
        const status = getStatus(w.endCashExpected, buffer);
        const fuel = fuelLevel(w.endCashExpected, buffer);
        const isConstraint = w.weekNumber === constraintWeek;

        // Distance from buffer — positive = above buffer, negative = below
        const distFromBuffer = w.endCashExpected - buffer;

        return { ...w, status, fuel, isConstraint, scenarioEnd, weekDelta, distFromBuffer };
    });

    return (
        <div className="flex-1 flex flex-col w-full relative min-h-0">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
                <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Cash Runway
                    </h3>
                    <p className="text-[10px] mt-0.5 text-slate-400/80">
                        Fuel gauge = % of buffer · color intensity = severity
                    </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap justify-end">
                    <div className="flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#059669" }} /> Safe</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#d97706" }} /> Low</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#e11d48" }} /> Gap</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "#1e293b" }} /> Negative</span>
                    </div>
                    {hasScenario && (
                        <span className="text-xs px-2 py-0.5 text-amber-400 border rounded font-semibold" style={{ borderColor: "rgba(245,158,11,0.25)", background: "rgba(120,53,15,0.10)" }}>
                            <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Scenario</span>
                        </span>
                    )}
                </div>
            </div>

            {/* Runway tiles */}
            <div className="flex gap-3 flex-1 min-h-0 overflow-x-auto overflow-y-hidden pb-4 items-start">
                {/* Near zone (W1–W6) — wider, more detail */}
                <div className="flex gap-3 shrink-0 items-start w-[800px]">
                    {enriched.slice(0, 6).map(w => {
                        const s = TILE_STYLES[w.status];
                        // For danger tiles, intensity 1 = worst-case (farthest below buffer)
                        const dangerIntensity = w.status === "danger" || w.status === "critical"
                            ? Math.min(1, Math.abs(w.distFromBuffer) / (buffer * 2))
                            : 0;
                        const safeIntensity = w.status === "safe" ? w.fuel : 0;
                        const intensity = w.status === "safe" ? safeIntensity : dangerIntensity;

                        return (
                            <button
                                key={w.weekNumber}
                                onClick={() => onWeekClick?.(w.weekNumber)}
                                title={`Week ${w.weekNumber} · ${formatDate(w.weekEnd)}\nExpected: ${fmtCompact(w.endCashExpected)}\nVs buffer: ${w.distFromBuffer >= 0 ? "+" : ""}${fmtCompact(w.distFromBuffer)}`}
                                className={[
                                    "flex-1 rounded-xl border p-3 text-left cursor-pointer group",
                                    w.isConstraint ? "ring-2 ring-red-500 ring-offset-1 ring-offset-black" : "",
                                    "hover:brightness-110 hover:shadow-lg hover:-translate-y-0.5 transition-all",
                                ].join(" ")}
                                style={{ ...s.bgStyle(intensity), ...s.borderStyle(intensity) }}
                            >
                                {/* Title row */}
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">W{w.weekNumber}</span>
                                    <span className="w-2.5 h-2.5 rounded-full ring-2 ring-white shadow-sm" style={{ background: s.dot }} />
                                </div>

                                {/* Date */}
                                <div className="text-[11px] mb-2" style={{ color: "var(--text-faint)" }}>{formatDate(w.weekEnd)}</div>

                                {/* Distance from buffer */}
                                <div className={`text-sm font-bold font-financial tracking-tight ${s.balanceColor} mb-0.5`}>
                                    {w.distFromBuffer >= 0 ? "+" : "–"}{fmtCompact(Math.abs(w.distFromBuffer))}
                                </div>
                                <div className="text-[10px] uppercase font-bold tracking-[0.1em] text-slate-400">vs buffer</div>

                                {/* Fuel gauge */}
                                <div className="mt-2.5 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
                                    <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.max(0, w.fuel * 100)}%`, backgroundColor: s.barFill }} />
                                </div>
                                <div className="text-[8px] mt-0.5" style={{ color: "var(--text-faint)" }}>
                                    {Math.round(w.fuel * 100)}% of buffer target
                                </div>

                                {/* What changed badge */}
                                {(() => {
                                    const diff = forecastDiff.get(w.weekNumber);
                                    if (!diff) return null;
                                    return (
                                        <div className={`mt-1 text-[11px] font-bold ${diff > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                            {diff > 0 ? <ArrowUp className="w-2.5 h-2.5" /> : <ArrowDown className="w-2.5 h-2.5" />} {fmtCompact(Math.abs(diff))} since last visit
                                        </div>
                                    );
                                })()}

                                {/* Scenario delta */}
                                {w.scenarioEnd !== null && w.weekDelta !== 0 && (
                                    <div className={`mt-1 text-[11px] font-medium ${w.weekDelta > 0 ? "text-amber-400" : "text-orange-400"}`}>
                                        <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> {w.weekDelta > 0 ? "+" : ""}{fmtCompact(w.weekDelta)}</span>
                                    </div>
                                )}

                                {/* Constraint badge */}
                                {w.isConstraint && (
                                    <div className="mt-1.5 text-[11px] text-red-400 font-bold flex items-center gap-1"><AlertTriangle className="w-2.5 h-2.5" /> LIMIT WEEK</div>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Divider */}
                <div className="flex flex-col items-center justify-center self-stretch min-h-[140px] px-2 shrink-0">
                    <div className="w-px flex-1" style={{ background: "var(--border-default)" }} />
                    <div className="text-[8px] rotate-90 my-4 whitespace-nowrap" style={{ color: "var(--text-faint)" }}>pattern zone &rarr;</div>
                    <div className="w-px flex-1" style={{ background: "var(--border-default)" }} />
                </div>

                {/* Far zone (W7–W13) — narrower */}
                <div className="flex gap-2 shrink-0 items-start w-[600px]">
                    {enriched.slice(6).map(w => {
                        const s = TILE_STYLES[w.status];
                        const intensity = w.status === "safe" ? w.fuel : Math.min(1, Math.abs(w.distFromBuffer) / (buffer * 2));

                        return (
                            <button
                                key={w.weekNumber}
                                onClick={() => onWeekClick?.(w.weekNumber)}
                                title={`Week ${w.weekNumber} · ${formatDate(w.weekEnd)}\n${fmtCompact(w.endCashExpected)}`}
                                className={[
                                    "flex-1 rounded-xl border p-2 text-center cursor-pointer",
                                    w.isConstraint ? "ring-2 ring-red-500" : "",
                                    "hover:brightness-110 transition-all",
                                ].join(" ")}
                                style={{ ...s.bgStyle(intensity), ...s.borderStyle(intensity) }}
                            >
                                <div className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>W{w.weekNumber}</div>
                                <div className={`text-[11px] font-semibold mt-1 ${s.balanceColor}`}>
                                    {w.distFromBuffer >= 0 ? "+" : "–"}{fmtCompact(Math.abs(w.distFromBuffer))}
                                </div>
                                {(() => {
                                    const diff = forecastDiff.get(w.weekNumber);
                                    if (!diff) return null;
                                    return (
                                        <div className={`text-[8px] font-bold ${diff > 0 ? "text-emerald-400" : "text-red-400"}`}>
                                            {diff > 0 ? <ArrowUp className="w-2 h-2" /> : <ArrowDown className="w-2 h-2" />}
                                        </div>
                                    );
                                })()}
                                {/* Mini fuel gauge */}
                                <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
                                    <div className="h-full rounded-full" style={{ width: `${Math.max(0, w.fuel * 100)}%`, backgroundColor: s.barFill }} />
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Legend */}
            <div className="mt-6 flex flex-wrap gap-4 text-xs border-t pt-4 items-center" style={{ color: "var(--text-faint)", borderColor: "var(--border-subtle)" }}>
                <span>Fuel gauge shows % of 2× buffer target</span>
                <span>·</span>
                <span className="flex items-center gap-1.5"><Circle className="w-2.5 h-2.5 fill-blue-500 stroke-none" /> Expected balance</span>
                <span className="flex items-center gap-1.5"><Square className="w-2.5 h-2.5 fill-emerald-500 stroke-none" /> Best cap</span>
                <span className="flex items-center gap-1.5"><Square className="w-2.5 h-2.5 fill-red-500 stroke-none" /> Worst cap</span>
                <span>Dash line = opening item</span>
                {hasScenario && <span className="flex items-center gap-1.5" style={{ color: "#b45309" }}><Circle className="w-2.5 h-2.5 fill-amber-500 stroke-none" /> Scenario balance</span>}
            </div>
        </div>
    );
}
