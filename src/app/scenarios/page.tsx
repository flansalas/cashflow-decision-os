"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ScenarioBuilder, type ScenarioItem } from "@/ui/ScenarioBuilder";
import { Box, ArrowLeft } from "lucide-react";
import { ForecastChart } from "@/ui/ForecastChart";

function ScenariosContent() {
    const searchParams = useSearchParams();
    const urlCompanyId = searchParams.get("companyId");
    
    const [data, setData] = useState<any>(null);
    const [scenarioItems, setScenarioItems] = useState<ScenarioItem[]>([]);

    useEffect(() => {
        let url = "/api/dashboard";
        if (urlCompanyId) url += `?companyId=${encodeURIComponent(urlCompanyId)}`;
        
        fetch(url)
            .then(res => res.json())
            .then(json => {
                if (json && !json.error) setData(json);
            })
            .catch(console.error);
    }, [urlCompanyId]);

    const companyId = data?.companyId || null;

    return (
        <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
            <header className="border-b sticky top-0 z-50 backdrop-blur-md" style={{ background: "rgba(255,255,255,0.92)", borderColor: "var(--border-subtle)" }}>
                <div className="max-w-[100rem] mx-auto px-5 py-4 flex items-center gap-3">
                    <a href="/plan" className="text-xs font-medium flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                        <ArrowLeft className="w-3 h-3" /> Plan
                    </a>
                    <span style={{ color: "var(--border-default)" }}>/</span>
                    <span style={{ color: "var(--color-primary)" }} className="font-bold text-sm flex items-center gap-1"><Box className="w-4 h-4" /> Scenarios</span>
                </div>
            </header>
            <main className="flex-1 max-w-[100rem] mx-auto w-full px-4 py-8 flex flex-col gap-6">
                
                <div className="bg-white rounded-2xl shadow-sm border p-6">
                    <h1 className="text-2xl font-bold mb-6">Scenario Builder</h1>
                    {data ? (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                            <div className="lg:col-span-1 border-r pr-8" style={{ borderColor: 'var(--border-subtle)' }}>
                                <ScenarioBuilder 
                                    companyId={companyId}
                                    weeks={data.forecast.weeks.map((w: any) => ({ weekNumber: w.weekNumber, weekEnd: w.weekEnd }))}
                                    items={scenarioItems}
                                    onAdd={item => setScenarioItems(prev => [...prev, item])}
                                    onUpdate={item => setScenarioItems(prev => prev.map(i => i.id === item.id ? item : i))}
                                    onRemove={id => setScenarioItems(prev => prev.filter(i => i.id !== id))}
                                    onClear={() => setScenarioItems([])}
                                    onLoad={setScenarioItems}
                                />
                            </div>
                            <div className="lg:col-span-2">
                                <h3 className="text-sm font-bold text-slate-800 mb-4">Live Scenario Preview</h3>
                                <div className="h-[400px]">
                                    <ForecastChart 
                                        weeks={data.forecast.weeks}
                                        buffer={data.assumptions.bufferMin}
                                        constraintWeek={null}
                                        scenarioItems={scenarioItems}
                                    />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="animate-pulse flex space-x-4">
                            <div className="flex-1 space-y-4 py-1">
                                <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                                <div className="space-y-2">
                                    <div className="h-4 bg-slate-200 rounded"></div>
                                    <div className="h-4 bg-slate-200 rounded w-5/6"></div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}

export default function ScenariosPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
                <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full" />
            </div>
        }>
            <ScenariosContent />
        </Suspense>
    );
}
