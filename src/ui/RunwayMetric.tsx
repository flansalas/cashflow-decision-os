"use client";

// ── Integrated Health Runway Gauge ───────────────────────────────────────────

export function RunwayMetric({ expectedWeek, worstWeek }: { expectedWeek: number | null; worstWeek: number | null }) {
    const TOTAL = 13;
    const isExpectedSafe = expectedWeek === null;
    const isWorstSafe = worstWeek === null;

    // Health synthesis
    const status = (isExpectedSafe && isWorstSafe) ? "STABLE" : isExpectedSafe ? "VULNERABLE" : "CRITICAL";
    
    const labelColor = 
        status === "STABLE" ? "var(--color-positive)" : 
        status === "VULNERABLE" ? "#d97706" : // Amber for vulnerable
        "var(--color-danger)";

    // Label construction: Range-first
    let runwayText: string;
    if (isExpectedSafe && isWorstSafe) {
        runwayText = "SAFE 13+";
    } else if (isExpectedSafe) {
        runwayText = `${worstWeek} — 13+ WKS`;
    } else if (worstWeek === expectedWeek) {
        runwayText = `${expectedWeek} WKS`;
    } else {
        runwayText = `${worstWeek} — ${expectedWeek} WKS`;
    }

    const expectedPct = Math.min((expectedWeek ?? TOTAL) / TOTAL, 1) * 100;
    const worstPct = worstWeek != null ? Math.min(worstWeek / TOTAL, 1) * 100 : null;

    return (
        <div className="flex flex-col items-end w-full">
            <div className="flex items-center gap-2 mb-1.5 translate-y-[-2px]">
                <span className="text-[10px] uppercase font-black tracking-[0.2em] opacity-30 text-slate-500">Financial Health</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black tracking-widest border" style={{ 
                    borderColor: labelColor, 
                    color: labelColor,
                    background: `${labelColor}15`
                }}>
                    {status}
                </span>
            </div>
            <div className="flex flex-col items-end gap-1">
                <p className="text-3xl sm:text-4xl font-bold font-financial leading-none tracking-tight" style={{ color: labelColor }}>
                    {runwayText}
                </p>
                <p className="text-[10px] uppercase font-bold opacity-40 mb-2 tracking-widest text-slate-500">Survival Range</p>
                
                {/* Status Bar */}
                <div className="relative w-full min-w-[120px] h-1.5 rounded-full overflow-hidden bg-slate-200/50">
                    {/* The "Safe Zone" bar (Expected) */}
                    <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 opacity-20" style={{ width: `${expectedPct}%`, background: labelColor }} />
                    
                    {/* The "Actual" bar (Worst case to expected case range) */}
                    {worstPct != null && (
                        <div className="absolute inset-y-0 rounded-full transition-all duration-700" style={{ 
                            left: `${worstPct}%`, 
                            width: `${expectedPct - worstPct}%`,
                            background: labelColor 
                        }} />
                    )}
                </div>
            </div>
        </div>
    );
}
