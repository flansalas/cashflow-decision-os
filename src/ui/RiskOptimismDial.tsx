"use client";

import { useState, useEffect } from "react";
import { ThermometerSun, ShieldCheck, ShieldAlert, Info } from "lucide-react";

interface Props {
    companyId: string;
    initialMargin: number;
    onChanged: () => void;
}

export function RiskOptimismDial({ companyId, initialMargin, onChanged }: Props) {
    const [margin, setMargin] = useState(initialMargin);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setMargin(initialMargin);
    }, [initialMargin]);

    const handleSave = async (val: number) => {
        setSaving(true);
        try {
            await fetch('/api/assumptions', {
                method: 'POST',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, projectionSafetyMargin: val })
            });
            onChanged();
        } finally {
            setSaving(false);
        }
    };

    const isConservative = margin < 1.0;
    const isBaseline = margin === 1.0;
    const isOptimistic = margin > 1.0;

    const accentColor = isConservative ? "#e11d48" : isBaseline ? "var(--color-primary)" : "#059669";
    const bgColor = isConservative ? "rgba(225,29,72,0.06)" : isBaseline ? "rgba(79,70,229,0.06)" : "rgba(5,150,105,0.06)";

    return (
        <div className="flex items-center gap-4 px-4 py-1.5 rounded-xl border shadow-sm transition-all" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center gap-3 group relative cursor-default">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 shadow-sm`} style={{ background: bgColor, color: accentColor }}>
                    {isConservative ? <ShieldAlert className="w-4 h-4" /> : isBaseline ? <ShieldCheck className="w-4 h-4" /> : <ThermometerSun className="w-4 h-4" />}
                </div>
                <div className="flex flex-col">
                     <p className="text-[9px] uppercase font-bold tracking-[0.2em] leading-none mb-1 text-slate-400">Stress Test</p>
                     <p className="text-xs font-bold leading-none tracking-tight" style={{ color: accentColor }}>
                        {margin.toFixed(2)}x {isBaseline ? 'Baseline' : isConservative ? 'Conservative' : 'Optimistic'}
                     </p>
                </div>
                
                <div className="ml-1 opacity-40 hover:opacity-100 cursor-help transition-opacity">
                    <Info className="w-3.5 h-3.5" />
                    <div className="absolute top-full mt-3 right-0 w-72 p-5 bg-slate-900 text-white text-[11px] rounded-2xl opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-300 z-[110] shadow-2xl border border-white/10 ring-1 ring-black scale-95 group-hover:scale-100 origin-top">
                        {/* Tooltip Arrow */}
                        <div className="absolute -top-1.5 right-8 w-3 h-3 bg-slate-900 border-l border-t border-white/10 rotate-45" />

                        <p className="font-bold mb-1.5 uppercase tracking-[0.1em] text-indigo-300">Historical Engine Tune</p>
                        <p className="leading-relaxed opacity-90">
                            Adjusts the safety margin applied to manual projections. 
                            <span className="block mt-2 font-bold text-amber-400">Decrease</span> to model extreme skepticism. 
                            <span className="block mt-1 font-bold text-emerald-400">Increase</span> to model aggressive collection growth.
                        </p>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3 border-l pl-3" style={{ borderColor: 'var(--border-subtle)' }}>
                <input 
                    type="range" 
                    min="0.5" max="1.5" step="0.05" 
                    value={margin}
                    onChange={(e) => setMargin(parseFloat(e.target.value))}
                    onMouseUp={(e) => handleSave(parseFloat((e.target as HTMLInputElement).value))}
                    onTouchEnd={(e) => handleSave(parseFloat((e.target as HTMLInputElement).value))}
                    className="w-24 sm:w-32 h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-slate-900 transition-all hover:bg-slate-200"
                />
                <div className="w-4 flex items-center justify-center">
                    {saving && (
                        <div className="w-3 h-3 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" />
                    )}
                </div>
            </div>
        </div>
    );
}
