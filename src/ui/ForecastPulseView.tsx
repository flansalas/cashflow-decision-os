// ui/ForecastPulseView.tsx
// "Waterfall" view — the most trusted format in managerial accounting.
// Each week = one bar showing: opening cash → green inflow segment → red outflow segment → ending dot.
// Best/worst whisker extends above/below the ending dot.
// Reads like a budget: "I start here, money comes in, money goes out, I end here."
"use client";

import type { ScenarioItem } from "./ScenarioBuilder";
import { Zap, Circle, Square, AlertTriangle } from "lucide-react";

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
    worstCaseDriver?: string | null;
}

interface Props {
    weeks: WeekData[];
    buffer: number;
    constraintWeek: number | null;
    scenarioItems?: ScenarioItem[];
    onWeekClick?: (weekNumber: number) => void;
}

function fmt(n: number): string {
    if (Math.abs(n) >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
    if (Math.abs(n) >= 1_000) return "$" + (n / 1_000).toFixed(0) + "k";
    return "$" + Math.round(n);
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return (d.getMonth() + 1) + "/" + d.getDate();
}

export function ForecastPulseView({ weeks, buffer, constraintWeek, scenarioItems = [], onWeekClick }: Props) {
    const hasScenario = scenarioItems.length > 0;
    const CHART_HEIGHT = 260; // px, the drawable canvas height

    // Build per-week running scenario delta
    const scenarioDeltaByWeek = new Map<number, number>();
    for (const item of scenarioItems) {
        const existing = scenarioDeltaByWeek.get(item.weekNumber) ?? 0;
        const delta = item.direction === "in" ? item.amount : -item.amount;
        scenarioDeltaByWeek.set(item.weekNumber, existing + delta);
    }
    const enriched = [];
    let accum = 0;
    for (const w of weeks) {
        const weekDelta = scenarioDeltaByWeek.get(w.weekNumber) ?? 0;
        accum += weekDelta;
        enriched.push({
            ...w,
            weekDelta,
            scenarioEnd: hasScenario ? w.endCashExpected + accum : null
        });
    }

    // Global range to normalize all values
    const allValues = enriched.flatMap(w => [
        w.startCash,
        w.endCashExpected,
        w.endCashBest,
        w.endCashWorst,
        w.startCash + w.inflowsExpected, // peak before outflows
    ]);
    const globalMax = Math.max(...allValues, buffer * 2, 1);
    const globalMin = Math.min(...allValues, 0);
    const range = globalMax - globalMin || 1;

    // Convert cash value → Y position in px (top = 0, bottom = CHART_HEIGHT)
    const toY = (val: number): number => {
        const pct = (val - globalMin) / range;
        return CHART_HEIGHT - pct * CHART_HEIGHT;
    };

    const bufferY = toY(buffer);
    const zeroY = toY(0);

    return (
        <div className="flex-1 flex flex-col w-full relative min-h-0">
            {/* Legend */}
            <div className="flex items-center justify-between mb-6">
                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400">
                    Waterfall Flow
                </p>
                <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest font-bold text-slate-400">
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 h-2 rounded-sm inline-block" style={{ background: "var(--color-positive)", opacity: 0.65 }} /> In
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 h-2 rounded-sm inline-block" style={{ background: "var(--color-danger)", opacity: 0.55 }} /> Out
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 h-px border-t-2 border-dashed border-amber-600 inline-block" /> Buffer
                    </span>
                    {hasScenario && (
                        <span className="px-2 py-0.5 text-amber-600 border rounded-lg font-bold bg-[#fffbeb]" style={{ borderColor: "rgba(245,158,11,0.2)" }}>
                            <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Sim Active</span>
                        </span>
                    )}
                </div>
            </div>            {/* SVG Waterfall Chart */}
            <div className="relative w-full overflow-x-auto pt-4">
                <svg
                    width="100%"
                    viewBox={`0 0 ${weeks.length * 80} ${CHART_HEIGHT + 60}`}
                    preserveAspectRatio="none"
                    className="w-full"
                    style={{ minHeight: `${CHART_HEIGHT + 60}px` }}
                >
                    {/* Buffer line */}
                    <line
                        x1={0} y1={bufferY}
                        x2={weeks.length * 80} y2={bufferY}
                        stroke="#b45309" strokeWidth={1.5} strokeDasharray="6 3" opacity={0.4}
                    />
                    <text x={weeks.length * 80 - 2} y={bufferY - 3} fill="#b45309" fontSize={8} textAnchor="end" opacity={0.6}>
                        Buffer {fmt(buffer)}
                    </text>

                    {/* Zero line */}
                    {globalMin < 0 && (
                        <line
                            x1={0} y1={zeroY}
                            x2={weeks.length * 80} y2={zeroY}
                            stroke="var(--color-danger)" strokeWidth={1.5} opacity={0.3}
                        />
                    )}

                    {/* Vertical grid lines between weeks */}
                    {enriched.map((_, i) => (
                        <line
                            key={i}
                            x1={i * 80} y1={0}
                            x2={i * 80} y2={CHART_HEIGHT}
                            stroke="var(--border-subtle)" strokeWidth={0.5}
                        />
                    ))}

                    {/* Week bars */}
                    {enriched.map((w, i) => {
                        const barX = i * 80 + 6;
                        const barW = 68;
                        const isConstraint = w.weekNumber === constraintWeek;

                        // Opening cash Y (bottom of the "pillar")
                        const startY = toY(w.startCash);
                        const endY = toY(w.endCashExpected);
                        const bestY = toY(w.endCashBest);
                        const worstY = toY(w.endCashWorst);

                        // Inflow segment: from startCash up to startCash + inflows
                        const inflowTopY = toY(w.startCash + w.inflowsExpected);
                        const inflowHeight = Math.abs(startY - inflowTopY);

                        // Outflow segment: from startCash + inflows down to endCash
                        const outflowTopY = inflowTopY;
                        const outflowBottomY = endY;
                        const outflowHeight = Math.abs(outflowBottomY - outflowTopY);

                        const endCashIsNegative = w.endCashExpected < 0;
                        const endCashBelowBuffer = w.endCashExpected < buffer;
                        const isStale = w.zone === "stale";

                        // Dot color at the ending position
                        const dotColor = isStale ? "#94a3b8" 
                            : endCashIsNegative ? "var(--color-danger)"
                            : endCashBelowBuffer ? "#eab308" : "var(--color-primary)";

                        // Scenario dot Y
                        const scenarioY = w.scenarioEnd !== null ? toY(w.scenarioEnd) : null;

                        return (
                            <g
                                key={w.weekNumber}
                                onClick={() => onWeekClick?.(w.weekNumber)}
                                style={{ cursor: onWeekClick ? "pointer" : "default" }}
                                className="group"
                            >
                                {/* Constraint week highlight */}
                                {isConstraint && (
                                    <rect
                                        x={barX - 4} y={0}
                                        width={barW + 8} height={CHART_HEIGHT}
                                        fill="var(--color-danger)" fillOpacity={0.03}
                                        rx={4}
                                    />
                                )}

                                {/* Opening cash indicator (thin horizontal tick at start level) */}
                                <line
                                    x1={barX} y1={startY}
                                    x2={barX + barW} y2={startY}
                                    stroke="var(--text-muted)" strokeWidth={1} strokeDasharray="3 2" opacity={0.4}
                                />

                                {/* Inflow segment (green) */}
                                {inflowHeight > 0 && (
                                    <rect
                                        x={barX + barW * 0.1}
                                        y={Math.min(startY, inflowTopY)}
                                        width={barW * 0.8}
                                        height={inflowHeight || 1}
                                        fill="var(--color-positive)"
                                        fillOpacity={0.5}
                                        rx={2}
                                    />
                                )}

                                {/* Outflow segment (red) */}
                                {outflowHeight > 0 && (
                                    <rect
                                        x={barX + barW * 0.1}
                                        y={Math.min(outflowTopY, outflowBottomY)}
                                        width={barW * 0.8}
                                        height={outflowHeight || 1}
                                        fill="var(--color-danger)"
                                        fillOpacity={0.4}
                                        rx={2}
                                    />
                                )}

                                {/* Best/Worst whisker */}
                                <line
                                    x1={barX + barW / 2} y1={bestY}
                                    x2={barX + barW / 2} y2={worstY}
                                    stroke={dotColor} strokeWidth={1} opacity={0.4}
                                />
                                <line x1={barX + barW / 2 - 4} y1={bestY} x2={barX + barW / 2 + 4} y2={bestY} stroke="var(--color-positive)" strokeWidth={1.5} />
                                <line x1={barX + barW / 2 - 4} y1={worstY} x2={barX + barW / 2 + 4} y2={worstY} stroke="var(--color-danger)" strokeWidth={1.5} />

                                {/* Ending cash dot */}
                                <circle
                                    cx={barX + barW / 2} cy={endY}
                                    r={5} fill={dotColor} stroke="white" strokeWidth={1.5}
                                />

                                {/* Scenario dot (amber) */}
                                {scenarioY !== null && (
                                    <circle
                                        cx={barX + barW / 2} cy={scenarioY}
                                        r={3.5} fill="#b45309" stroke="white" strokeWidth={1}
                                    />
                                )}

                                {/* Constraint "OUT OF CASH" marker */}
                                {isConstraint && (
                                    <text
                                        x={barX + barW / 2} y={8}
                                        fill="var(--color-danger)" fontSize={7} textAnchor="middle" fontWeight="bold"
                                    >
                                        LIMIT
                                    </text>
                                )}

                                {/* Week label */}
                                <text
                                    x={barX + barW / 2} y={CHART_HEIGHT + 14}
                                    fill={isConstraint ? "var(--color-danger)" : "var(--text-muted)"}
                                    fontSize={8} textAnchor="middle" fontWeight={isConstraint ? "bold" : "normal"}
                                >
                                    W{w.weekNumber}
                                </text>

                                {/* Date label */}
                                <text x={barX + barW / 2} y={CHART_HEIGHT + 24} fill="var(--text-faint)" fontSize={7} textAnchor="middle">
                                    {formatDate(w.weekEnd)}
                                </text>

                                {/* Ending balance label */}
                                <text
                                    x={barX + barW / 2} y={CHART_HEIGHT + 36}
                                    fill={isStale ? "var(--text-muted)" : endCashIsNegative ? "var(--color-danger)" : endCashBelowBuffer ? "#b45309" : "var(--color-positive)"}
                                    fontSize={7.5} textAnchor="middle" fontWeight="bold"
                                >
                                    {fmt(w.endCashExpected)}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>

            {/* Legend */}
            <div className="mt-3 flex flex-wrap gap-4 text-xs border-t pt-3" style={{ color: "var(--text-faint)", borderColor: "var(--border-subtle)" }}>
                <span className="flex items-center gap-1.5"><Circle className="w-2.5 h-2.5 fill-blue-500 stroke-none" /> Expected balance</span>
                <span className="flex items-center gap-1.5"><Square className="w-2.5 h-2.5 fill-emerald-500 stroke-none" /> Best cap</span>
                <span className="flex items-center gap-1.5"><Square className="w-2.5 h-2.5 fill-red-500 stroke-none" /> Worst cap</span>
                <span>Dash line = opening item</span>
                {hasScenario && <span className="flex items-center gap-1.5" style={{ color: "#b45309" }}><Circle className="w-2.5 h-2.5 fill-amber-500 stroke-none" /> Scenario balance</span>}
            </div>
        </div>
    );
}
