// ui/ForecastBarView.tsx
// "Accordion Grid" style bar chart — bold stacked inflow/outflow bars per week.
// Inflows = emerald bars above center line. Outflows = coral bars below.
// Closely matches the "13-Week Accordion Grid" mockup aesthetic.
"use client";

import type { ScenarioItem } from "./ScenarioBuilder";
import { Zap } from "lucide-react";

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

export function ForecastBarView({ weeks, buffer, constraintWeek, scenarioItems = [], onWeekClick }: Props) {
    const hasScenario = scenarioItems.length > 0;
    const BAR_AREA_HEIGHT = 200; // px per half (above and below center line)
    const TOTAL_SVG_HEIGHT = BAR_AREA_HEIGHT * 2 + 80; // above + below + labels
    const CENTER_Y = BAR_AREA_HEIGHT; // y coordinate of the zero/center line
    const COL_W = 80;
    const BAR_W = 52;
    const BAR_PAD = (COL_W - BAR_W) / 2;

    // Build per-week running scenario delta
    const scenarioDeltaByWeek = new Map<number, number>();
    for (const item of scenarioItems) {
        const existing = scenarioDeltaByWeek.get(item.weekNumber) ?? 0;
        const delta = item.direction === "in" ? item.amount : -item.amount;
        scenarioDeltaByWeek.set(item.weekNumber, existing + delta);
    }

    const maxInflow = Math.max(...weeks.map(w => w.inflowsExpected), 1);
    const maxOutflow = Math.max(...weeks.map(w => w.outflowsExpected), 1);
    const absMax = Math.max(maxInflow, maxOutflow);

    // Scale a cash amount to bar height pixels (capped at BAR_AREA_HEIGHT)
    const toBarH = (val: number) => Math.min((val / absMax) * BAR_AREA_HEIGHT * 0.88, BAR_AREA_HEIGHT);

    const totalWidth = weeks.length * COL_W;

    return (
        <div className="flex-1 flex flex-col w-full relative min-h-0">
            {/* Legend */}
            <div className="flex items-start justify-between mb-6">
                <div>
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Cash Flow Grid
                    </h3>
                </div>
                <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest font-bold text-slate-400">
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "var(--color-positive)", opacity: 0.7 }} /> In
                    </span>
                    <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-sm inline-block" style={{ background: "var(--color-danger)", opacity: 0.6 }} /> Out
                    </span>
                    {hasScenario && (
                        <span className="px-2 py-0.5 text-amber-600 border rounded-lg font-bold bg-[#fffbeb]" style={{ borderColor: "rgba(245,158,11,0.2)" }}>
                            <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Sim active</span>
                        </span>
                    )}
                </div>
            </div>

            {/* SVG Chart */}
            <div className="w-full overflow-x-auto pt-4">
                <svg
                    width="100%"
                    viewBox={`0 0 ${totalWidth} ${TOTAL_SVG_HEIGHT}`}
                    preserveAspectRatio="none"
                    style={{ minHeight: `${TOTAL_SVG_HEIGHT}px`, display: "block" }}
                >
                    {/* Background grid columns — alternate subtle shading */}
                    {weeks.map((w, i) => (
                        <rect
                            key={`bg-${i}`}
                            x={i * COL_W} y={0}
                            width={COL_W} height={TOTAL_SVG_HEIGHT - 80}
                            fill={i % 2 === 0 ? "rgba(79,70,229,0.01)" : "rgba(79,70,229,0.025)"}
                        />
                    ))}

                    {/* Horizontal grid lines */}
                    {[0.25, 0.5, 0.75].map(pct => (
                        <g key={`grid-${pct}`}>
                            <line
                                x1={0} y1={CENTER_Y - pct * BAR_AREA_HEIGHT * 0.88}
                                x2={totalWidth} y2={CENTER_Y - pct * BAR_AREA_HEIGHT * 0.88}
                                stroke="var(--border-subtle)" strokeWidth={0.5} opacity={0.3}
                            />
                            <line
                                x1={0} y1={CENTER_Y + pct * BAR_AREA_HEIGHT * 0.88}
                                x2={totalWidth} y2={CENTER_Y + pct * BAR_AREA_HEIGHT * 0.88}
                                stroke="var(--border-subtle)" strokeWidth={0.5} opacity={0.3}
                            />
                        </g>
                    ))}

                    {/* Center zero line */}
                    <line
                        x1={0} y1={CENTER_Y}
                        x2={totalWidth} y2={CENTER_Y}
                        stroke="var(--border-default)" strokeWidth={1}
                    />

                    {/* Bars per week */}
                    {weeks.map((w, i) => {
                        const x = i * COL_W + BAR_PAD;
                        const isConstraint = w.weekNumber === constraintWeek;
                        const isBelowBuffer = w.endCashExpected < buffer;
                        const isNegative = w.endCashExpected < 0;

                        const inflowH = toBarH(w.inflowsExpected);
                        const outflowH = toBarH(w.outflowsExpected);

                        // Scenario adjustment
                        const scenarioDelta = scenarioDeltaByWeek.get(w.weekNumber) ?? 0;
                        const scenarioInflowH = hasScenario && scenarioDelta > 0
                            ? toBarH(w.inflowsExpected + scenarioDelta)
                            : null;

                        // Net indicator dot color
                        const dotColor = isNegative ? "var(--color-danger)"
                            : isBelowBuffer ? "#eab308"
                                : "var(--color-positive)";

                        return (
                            <g
                                key={w.weekNumber}
                                onClick={() => onWeekClick?.(w.weekNumber)}
                                style={{ cursor: onWeekClick ? "pointer" : "default" }}
                            >
                                {/* Constraint column highlight */}
                                {isConstraint && (
                                    <rect
                                        x={i * COL_W} y={0}
                                        width={COL_W} height={TOTAL_SVG_HEIGHT - 80}
                                        fill="var(--color-danger)" fillOpacity={0.03}
                                    />
                                )}

                                {i === 0 && inflowH > 40 && (
                                    <text
                                        x={x + BAR_W / 2} y={CENTER_Y - inflowH / 2}
                                        fill="var(--color-positive)" fillOpacity={0.8} fontSize={7.5} textAnchor="middle" fontWeight="semibold"
                                    >
                                        +{fmt(w.inflowsExpected)}
                                    </text>
                                )}
                                {i === 0 && outflowH > 40 && (
                                    <text
                                        x={x + BAR_W / 2} y={CENTER_Y + outflowH / 2 + 5}
                                        fill="var(--color-danger)" fillOpacity={0.8} fontSize={7.5} textAnchor="middle" fontWeight="semibold"
                                    >
                                        &ndash;{fmt(w.outflowsExpected)}
                                    </text>
                                )}

                                {/* Inflow bar (emerald, above center) */}
                                {inflowH > 0 && (
                                    <rect
                                        x={x} y={CENTER_Y - inflowH}
                                        width={BAR_W} height={inflowH}
                                        fill={isNegative ? "#94a3b8" : "var(--color-positive)"}
                                        fillOpacity={isNegative ? 0.3 : 0.7}
                                        rx={3}
                                    />
                                )}

                                {/* Scenario overlay (amber tint over inflow) */}
                                {scenarioInflowH && scenarioInflowH > inflowH && (
                                    <rect
                                        x={x} y={CENTER_Y - scenarioInflowH}
                                        width={BAR_W} height={scenarioInflowH - inflowH}
                                        fill="#f59e0b" fillOpacity={0.6} rx={3}
                                    />
                                )}

                                {/* Outflow bar (coral, below center) */}
                                {outflowH > 0 && (
                                    <rect
                                        x={x} y={CENTER_Y}
                                        width={BAR_W} height={outflowH}
                                        fill="var(--color-danger)"
                                        fillOpacity={isNegative ? 0.7 : 0.5}
                                        rx={3}
                                    />
                                )}

                                {/* Constraint marker */}
                                {isConstraint && (
                                    <text
                                        x={i * COL_W + COL_W / 2} y={14}
                                        fill="var(--color-danger)" fontSize={7} textAnchor="middle" fontWeight="bold"
                                    >
                                        ⚠ LIMIT
                                    </text>
                                )}

                                {/* Net balance dot on center line */}
                                <circle
                                    cx={i * COL_W + COL_W / 2} cy={CENTER_Y}
                                    r={4} fill={dotColor} stroke="white" strokeWidth={1}
                                />

                                {/* Bottom labels */}
                                <text
                                    x={i * COL_W + COL_W / 2} y={TOTAL_SVG_HEIGHT - 60}
                                    fill={isConstraint ? "var(--color-danger)" : "var(--text-muted)"}
                                    fontSize={8} textAnchor="middle"
                                    fontWeight={isConstraint ? "bold" : "normal"}
                                >
                                    W{w.weekNumber}
                                </text>
                                <text
                                    x={i * COL_W + COL_W / 2} y={TOTAL_SVG_HEIGHT - 50}
                                    fill="var(--text-faint)" fontSize={6.5} textAnchor="middle"
                                >
                                    {formatDate(w.weekEnd)}
                                </text>
                                <text
                                    x={i * COL_W + COL_W / 2} y={TOTAL_SVG_HEIGHT - 38}
                                    fill={isNegative ? "var(--color-danger)" : isBelowBuffer ? "#b45309" : "var(--color-positive)"}
                                    fontSize={7} textAnchor="middle" fontWeight="bold"
                                >
                                    {fmt(w.endCashExpected)}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            </div>

            {/* Legend footer */}
            <div className="mt-4 flex flex-wrap gap-4 text-xs border-t pt-4 shrink-0" style={{ color: "var(--text-faint)", borderColor: "var(--border-subtle)" }}>
                <span>🟢 Safe level</span>
                <span>🟡 Below buffer</span>
                <span>🔴 Critical / Negative</span>
                {hasScenario && <span style={{ color: "#b45309" }}>🟡 Scenario inflow adjustment</span>}
            </div>
        </div>
    );
}
