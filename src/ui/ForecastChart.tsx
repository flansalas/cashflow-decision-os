// ui/ForecastChart.tsx – Recharts line chart with best/worst band + buffer line + scenario overlay
"use client";

import {
    ResponsiveContainer,
    Line,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ReferenceLine,
    ComposedChart,
    Legend,
} from "recharts";
import { Zap } from "lucide-react";
import type { ScenarioItem } from "./ScenarioBuilder";

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
    onWeekClick?: (weekNumber: number) => void;
}

function fmt(n: number): string {
    return "$" + Math.round(n).toLocaleString("en-US", { minimumFractionDigits: 0 });
}

function fmtChartAxis(n: number): string {
    if (Math.abs(n) >= 1000) {
        return "$" + (n / 1000).toFixed(0) + "k";
    }
    return "$" + n.toFixed(0);
}

function formatDate(dateStr: string): string {
    const d = new Date(dateStr);
    return (d.getMonth() + 1) + "/" + d.getDate();
}

export function ForecastChart({ weeks, buffer, constraintWeek, scenarioItems = [], onWeekClick }: Props) {
    const hasScenario = scenarioItems.length > 0;

    // Build per-week net scenario delta (positive = more cash, negative = less cash)
    const scenarioDeltaByWeek = new Map<number, number>();
    for (const item of scenarioItems) {
        const existing = scenarioDeltaByWeek.get(item.weekNumber) ?? 0;
        const delta = item.direction === "in" ? item.amount : -item.amount;
        scenarioDeltaByWeek.set(item.weekNumber, existing + delta);
    }

    // Build chart data, with running scenario totals
    let runningScenarioCash = 0;
    const chartData = weeks.map(w => {
        const dateLabel = formatDate(w.weekEnd);
        const weekDelta = scenarioDeltaByWeek.get(w.weekNumber) ?? 0;
        runningScenarioCash += weekDelta;
        const scenarioEnd = hasScenario ? Math.round(w.endCashExpected + runningScenarioCash) : undefined;
        return {
            name: dateLabel,
            weekNum: `Week ${w.weekNumber}`,
            opening: w.startCash,
            inflow: w.inflowsExpected,
            outflow: w.outflowsExpected,
            expected: Math.round(w.endCashExpected),
            best: Math.round(w.endCashBest),
            worst: Math.round(w.endCashWorst),
            scenario: scenarioEnd,
            scenarioDelta: weekDelta !== 0 ? weekDelta : undefined,
            zone: w.zone,
            bandHigh: w.zone !== "committed" ? Math.round(w.endCashBest) : undefined,
            bandLow: w.zone !== "committed" ? Math.round(w.endCashWorst) : undefined,
        };
    });

    const constraintLabel = constraintWeek
        ? formatDate(weeks[constraintWeek - 1]?.weekEnd)
        : null;

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            const scenarioDelta = data.scenarioDelta;
            return (
                <div className="rounded-2xl p-5 shadow-2xl min-w-[280px] border border-white/20 backdrop-blur-md" style={{ background: "rgba(15, 23, 42, 0.95)", color: "white" }}>
                    <div className="flex justify-between items-end mb-4 border-b border-white/10 pb-3">
                        <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 leading-none mb-1">Timeline</p>
                            <h4 className="text-sm font-bold text-white leading-none">{data.weekNum} · {label}</h4>
                        </div>
                        <div className="text-right">
                             <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 leading-none mb-1">Status</p>
                             <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${data.expected < buffer ? "bg-rose-500/20 text-rose-300 border-rose-500/30" : "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"}`}>
                                {data.expected < 0 ? "DEPLETED" : data.expected < buffer ? "BELOW BUFFER" : "SAFE"}
                             </span>
                        </div>
                    </div>

                    {/* Flow Breakdown */}
                    <div className="space-y-2 mb-4">
                        <div className="flex justify-between items-center text-[11px] text-slate-400">
                             <span className="uppercase tracking-widest font-bold">Opening</span>
                             <span className="font-financial text-white">{fmt(data.opening)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-emerald-400">
                             <span className="uppercase tracking-widest font-bold">Inflow</span>
                             <span className="font-financial">+{fmt(data.inflow)}</span>
                        </div>
                        <div className="flex justify-between items-center text-[11px] text-rose-400">
                             <span className="uppercase tracking-widest font-bold">Outflow</span>
                             <span className="font-financial">-{fmt(data.outflow)}</span>
                        </div>
                    </div>

                    {/* Terminal Balance */}
                    <div className="pt-3 border-t border-white/10 space-y-2.5">
                        <div className="flex justify-between items-center">
                            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-200">Terminal Cash</span>
                            <span className="text-lg font-black font-financial text-white">{fmt(data.expected)}</span>
                        </div>
                        
                        {(data.best !== data.expected || data.worst !== data.expected) && (
                            <div className="grid grid-cols-2 gap-3 pt-1">
                                <div className="p-2 rounded-xl bg-white/5 border border-white/5">
                                    <p className="text-[9px] uppercase font-bold tracking-widest text-emerald-500 mb-0.5">Best</p>
                                    <p className="text-[11px] font-financial font-bold text-emerald-200">{fmt(data.best)}</p>
                                </div>
                                <div className="p-2 rounded-xl bg-white/5 border border-white/5">
                                    <p className="text-[9px] uppercase font-bold tracking-widest text-rose-500 mb-0.5">Worst</p>
                                    <p className="text-[11px] font-financial font-bold text-rose-200">{fmt(data.worst)}</p>
                                </div>
                            </div>
                        )}

                        {hasScenario && data.scenario !== undefined && (
                            <div className="mt-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                                <div className="flex justify-between items-center mb-1">
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400 flex items-center gap-1.5"><Zap className="w-3 h-3" /> Simulation</span>
                                    <span className="text-xs font-black font-financial text-amber-200">{fmt(data.scenario)}</span>
                                </div>
                                <p className="text-[9px] text-amber-500/60 leading-none">Scenario impact: {scenarioDelta > 0 ? "+" : ""}{fmt(scenarioDelta)}</p>
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="flex-1 flex flex-col w-full relative min-h-[300px]">
            {hasScenario && (
                <div className="absolute top-0 right-2 z-10">
                    <span className="text-[10px] px-3 py-1 text-amber-600 border rounded-xl font-bold uppercase tracking-widest flex items-center gap-2 shadow-sm bg-[#fffbeb]" style={{ borderColor: "rgba(245,158,11,0.2)" }}>
                        <Zap className="w-3.5 h-3.5" /> Simulation Active
                    </span>
                </div>
            )}
            <div className="w-full flex-1" style={{ minHeight: 400 }}>
                <ResponsiveContainer width="100%" height={400}>
                    <ComposedChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                        <XAxis
                            dataKey="name"
                            tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                            stroke="var(--border-default)"
                        />
                        <YAxis
                            tickFormatter={fmtChartAxis}
                            tick={{ fill: "var(--text-muted)", fontSize: 10 }}
                            stroke="var(--border-default)"
                        />
                        <Tooltip 
                            content={<CustomTooltip />} 
                            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1, strokeDasharray: '4 4' }}
                            isAnimationActive={false}
                        />
                        <Legend
                            verticalAlign="top"
                            align="right"
                            height={40}
                            iconType="circle"
                            iconSize={8}
                            wrapperStyle={{ fontSize: '9px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--text-muted)', paddingTop: '10px' }}
                        />

                        {/* Band (best/worst range) */}
                        <Area
                            dataKey="bandHigh"
                            stroke="none"
                            fill="var(--color-risk-low)"
                            fillOpacity={0.08}
                            type="monotone"
                            connectNulls={false}
                            legendType="none"
                        />
                        <Area
                            dataKey="bandLow"
                            stroke="none"
                            fill="var(--color-risk-high)"
                            fillOpacity={0.08}
                            type="monotone"
                            connectNulls={false}
                            legendType="none"
                        />

                        {/* Best line (dashed, faint) */}
                        <Line
                            type="monotone"
                            dataKey="best"
                            name="Best Case"
                            stroke="var(--color-positive)"
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                            dot={false}
                            opacity={0.6}
                        />

                        {/* Worst line (dashed, faint) */}
                        <Line
                            type="monotone"
                            dataKey="worst"
                            name="Worst Case"
                            stroke="var(--color-danger)"
                            strokeWidth={1.5}
                            strokeDasharray="4 4"
                            dot={false}
                            opacity={0.6}
                        />

                        {/* Expected line (main) – dots are clickable */}
                        <Line
                            type="monotone"
                            dataKey="expected"
                            name="Expected"
                            stroke="#0f172a"
                            strokeWidth={3}
                            strokeLinecap="round"
                            dot={{ 
                                r: 3.5, 
                                fill: "#ffffff", 
                                stroke: "#0f172a", 
                                strokeWidth: 2, 
                                cursor: onWeekClick ? "pointer" : "default" 
                            }}
                            activeDot={onWeekClick ? {
                                r: 7, 
                                fill: "#0f172a", 
                                stroke: "#ffffff", 
                                strokeWidth: 2, 
                                cursor: "pointer",
                                className: "shadow-xl transition-all",
                                onClick: (_: any, payload: any) => {
                                    const weekNum = payload?.payload?.weekNum;
                                    if (weekNum && onWeekClick) onWeekClick(parseInt(weekNum.replace("Week ", "")));
                                }
                            } : { r: 6, fill: "#0f172a", stroke: "#ffffff", strokeWidth: 2 }}
                            animationDuration={1500}
                        />

                        {/* Scenario overlay (orange) – only when active */}
                        {hasScenario && (
                            <Line
                                type="monotone"
                                dataKey="scenario"
                                name="With Scenario"
                                stroke="var(--color-risk-med)"
                                strokeWidth={2}
                                strokeDasharray="6 3"
                                dot={{ r: 3, fill: "var(--color-risk-med)" }}
                                activeDot={{ r: 5, fill: "var(--color-risk-med)" }}
                            />
                        )}

                        {/* Buffer line — heavier weight */}
                        <ReferenceLine
                            y={buffer}
                            stroke="var(--color-risk-med)"
                            strokeWidth={1.5}
                            strokeDasharray="6 3"
                            label={{
                                value: `Buffer ${fmtChartAxis(buffer)}`,
                                position: "right",
                                fill: "var(--color-risk-med)",
                                fontSize: 11,
                            }}
                        />

                        {/* Zero line — bold danger threshold */}
                        <ReferenceLine y={0} stroke="var(--color-risk-high)" strokeWidth={2.5} />

                        {/* Constraint week — "OUT OF CASH" wall */}
                        {constraintLabel && (() => {
                            const weekIdx = weeks.findIndex(w => formatDate(w.weekEnd) === constraintLabel);
                            // Get the previous week label for the filled area start
                            const prevLabel = weekIdx > 0 ? formatDate(weeks[weekIdx - 1].weekEnd) : constraintLabel;
                            return (
                                <>
                                    <ReferenceLine
                                        x={constraintLabel as string}
                                        stroke="var(--color-danger)"
                                        strokeWidth={2}
                                        strokeDasharray="4 2"
                                        label={{
                                            value: `CRITICAL DEPLETION (W${constraintWeek})`,
                                            position: "insideTopLeft",
                                            fill: "var(--color-danger)",
                                            fontSize: 9,
                                            fontWeight: "800",
                                            letterSpacing: "0.1em"
                                        }}
                                    />
                                </>
                            );
                        })()}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
