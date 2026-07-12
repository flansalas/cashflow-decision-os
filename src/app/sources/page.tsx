"use client";

import { useState, useEffect } from "react";
import { ARAPUploadStep } from "@/ui/ARAPUploadStep";
import { BankUploadStep } from "@/ui/BankUploadStep";
import { Database, ArrowLeft, Upload, Landmark, X } from "lucide-react";

export default function SourcesPage() {
    const [companyId, setCompanyId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<"arap" | "bank">("arap");

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
                    <span style={{ color: "var(--color-primary)" }} className="font-bold text-sm flex items-center gap-1"><Database className="w-4 h-4" /> Data Sources</span>
                </div>
            </header>
            <main className="max-w-4xl mx-auto px-4 py-8">
                <div className="bg-white rounded-2xl shadow-sm border p-6">
                    <h1 className="text-2xl font-bold mb-6">Data Sources</h1>
                    <div className="flex gap-4 border-b mb-6" style={{ borderColor: "var(--border-subtle)" }}>
                        <button 
                            onClick={() => setActiveTab("arap")}
                            className={`pb-3 px-2 font-bold text-sm ${activeTab === "arap" ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-800"}`}
                        >
                            <span className="flex items-center gap-2"><Upload className="w-4 h-4" /> AR/AP Report</span>
                        </button>
                        <button 
                            onClick={() => setActiveTab("bank")}
                            className={`pb-3 px-2 font-bold text-sm ${activeTab === "bank" ? "border-b-2 border-emerald-600 text-emerald-700" : "text-slate-500 hover:text-slate-800"}`}
                        >
                            <span className="flex items-center gap-2"><Landmark className="w-4 h-4" /> Bank Statement</span>
                        </button>
                    </div>

                    {companyId ? (
                        <div>
                            {activeTab === "arap" && (
                                <ARAPUploadStep companyId={companyId} onDone={() => { alert("Upload complete!"); }} />
                            )}
                            {activeTab === "bank" && (
                                <BankUploadStep companyId={companyId} onDone={() => { alert("Bank upload complete!"); }} />
                            )}
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
