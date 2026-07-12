"use client";

import { useState, useEffect } from "react";
import { OnboardingWizard } from "@/ui/OnboardingWizard";
import { Settings2, ArrowLeft, Box } from "lucide-react";

export default function SettingsPage() {
    const [companyId, setCompanyId] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/dashboard")
            .then(res => res.json())
            .then(data => {
                if (data.company?.id) {
                    setCompanyId(data.company.id);
                }
            })
            .catch(console.error);
    }, []);

    return (
        <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
            <header className="border-b sticky top-0 z-50 backdrop-blur-md" style={{ background: "rgba(255,255,255,0.92)", borderColor: "var(--border-subtle)" }}>
                <div className="max-w-[100rem] mx-auto px-5 py-4 flex items-center gap-3">
                    <a href="/plan" className="text-xs font-medium flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                        <ArrowLeft className="w-3 h-3" /> Plan
                    </a>
                    <span style={{ color: "var(--border-default)" }}>/</span>
                    <span style={{ color: "var(--color-primary)" }} className="font-bold text-sm flex items-center gap-1"><Settings2 className="w-4 h-4" /> Settings</span>
                </div>
            </header>
            <main className="max-w-4xl mx-auto px-4 py-8">
                <div className="bg-white rounded-2xl shadow-sm border overflow-hidden" style={{ borderColor: "var(--border-subtle)" }}>
                    {companyId ? (
                        <OnboardingWizard 
                            companyId={companyId} 
                            startStep={0} 
                            onClose={() => { alert("Settings updated!"); }} 
                        />
                    ) : (
                        <div className="p-8 animate-pulse flex space-x-4">
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
