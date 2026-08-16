"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, ShieldCheck, ShieldAlert } from "lucide-react";

export default function CertificationReviewPage() {
    const router = useRouter();
    const [checkpointId, setCheckpointId] = useState("");
    const [rationale, setRationale] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<any>(null);
    const [error, setError] = useState("");

    const [stressInputs, setStressInputs] = useState({
        arDelayWeeks: 4,
        residualInflowReductionPct: 20
    });

    const submitDecision = async (status: 'certified' | 'not_safe') => {
        if (!checkpointId) {
            setError("Forecast Checkpoint ID is required.");
            return;
        }

        setLoading(true);
        setError("");
        
        try {
            const res = await fetch("/api/forecast/certification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    forecastCheckpointId: checkpointId,
                    status,
                    rationale,
                    bufferRationale: status === 'certified' ? "Adequate buffer coverage" : "",
                    stressInputs
                })
            });
            
            const json = await res.json();
            if (!res.ok || json.error) {
                setError(json.error || "Failed to certify");
                setResult(null);
            } else {
                setResult(json.certification);
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex flex-col bg-slate-50">
            <header className="border-b bg-white px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
                <button onClick={() => router.back()} className="text-slate-500 hover:text-slate-900 transition-colors">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <h1 className="text-xl font-semibold text-slate-800">Forecast Risk Review & Certification</h1>
            </header>

            <main className="flex-1 max-w-4xl mx-auto w-full p-8">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 mb-8">
                    <h2 className="text-lg font-semibold text-slate-800 mb-6 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-amber-500" />
                        Evaluate Forecast Governance
                    </h2>
                    
                    <div className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Forecast Checkpoint ID</label>
                            <input 
                                type="text"
                                value={checkpointId}
                                onChange={(e) => setCheckpointId(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="chk_..."
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Stress AR Delay (Weeks)</label>
                                <input 
                                    type="number"
                                    value={stressInputs.arDelayWeeks}
                                    onChange={(e) => setStressInputs(prev => ({ ...prev, arDelayWeeks: Number(e.target.value) }))}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Residual Inflow Reduction (%)</label>
                                <input 
                                    type="number"
                                    value={stressInputs.residualInflowReductionPct}
                                    onChange={(e) => setStressInputs(prev => ({ ...prev, residualInflowReductionPct: Number(e.target.value) }))}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Owner Rationale</label>
                            <textarea 
                                value={rationale}
                                onChange={(e) => setRationale(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 h-24"
                                placeholder="Explain decision rationale..."
                            />
                        </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-100 flex items-center justify-end gap-4">
                        <button 
                            onClick={() => submitDecision('not_safe')}
                            disabled={loading}
                            className="px-4 py-2 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50 font-medium transition-colors flex items-center gap-2"
                        >
                            <ShieldAlert className="w-4 h-4" />
                            Mark Not Safe
                        </button>
                        <button 
                            onClick={() => submitDecision('certified')}
                            disabled={loading}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium transition-colors flex items-center gap-2"
                        >
                            <ShieldCheck className="w-4 h-4" />
                            Certify for Decision Use
                        </button>
                    </div>

                    {error && (
                        <div className="mt-6 p-4 bg-red-50 text-red-800 rounded-lg border border-red-200">
                            <strong>Error:</strong> {error}
                        </div>
                    )}

                    {result && (
                        <div className="mt-6 p-6 bg-slate-50 rounded-lg border border-slate-200">
                            <h3 className="text-md font-semibold text-slate-800 mb-4">Certification Result</h3>
                            
                            <div className="grid grid-cols-2 gap-8">
                                <div>
                                    <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Base Metrics</h4>
                                    <dl className="space-y-2 text-sm">
                                        <div className="flex justify-between"><dt className="text-slate-600">Lowest Cash:</dt><dd className="font-mono">${result.baseMinCash?.toLocaleString()}</dd></div>
                                        <div className="flex justify-between"><dt className="text-slate-600">Buffer Headroom:</dt><dd className="font-mono">${result.baseBufferHeadroom?.toLocaleString()}</dd></div>
                                        <div className="flex justify-between"><dt className="text-slate-600">Max Deficit:</dt><dd className="font-mono">${result.baseMaxDeficit?.toLocaleString()}</dd></div>
                                    </dl>
                                </div>
                                <div>
                                    <h4 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Downside Stress</h4>
                                    <dl className="space-y-2 text-sm">
                                        <div className="flex justify-between"><dt className="text-slate-600">Lowest Cash:</dt><dd className="font-mono">${result.downsideMinCash?.toLocaleString()}</dd></div>
                                        <div className="flex justify-between"><dt className="text-slate-600">Buffer Headroom:</dt><dd className="font-mono">${result.downsideBufferHeadroom?.toLocaleString()}</dd></div>
                                        <div className="flex justify-between"><dt className="text-slate-600">Max Deficit:</dt><dd className="font-mono">${result.downsideMaxDeficit?.toLocaleString()}</dd></div>
                                    </dl>
                                </div>
                            </div>

                            <div className="mt-6 pt-4 border-t border-slate-200">
                                <p className="text-sm text-slate-700">
                                    <span className="font-medium">Final Status:</span>{' '}
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${result.status === 'certified' ? 'bg-emerald-100 text-emerald-800' : result.status === 'cannot_certify' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                                        {result.status}
                                    </span>
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
