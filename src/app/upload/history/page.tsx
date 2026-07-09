"use client";

import React, { useEffect, useState } from "react";


export default function ImportHistoryPage() {
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [rollingBackId, setRollingBackId] = useState<string | null>(null);
    const companyId = "c1"; // Hardcoded for this slice

    useEffect(() => {
        fetchHistory();
    }, []);

    const fetchHistory = async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/upload/history?companyId=${companyId}`);
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to fetch history");
            }
            const data = await res.json();
            setHistory(data.history);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleRollback = async (applicationId: string) => {
        if (!confirm("Are you sure you want to roll back this import? This action will reverse all inserted and updated records from this import.")) return;

        setRollingBackId(applicationId);
        try {
            const res = await fetch(`/api/upload/rollback?companyId=${companyId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ applicationId })
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Rollback failed");
            }
            alert("Rollback successful.");
            fetchHistory();
        } catch (e: any) {
            alert(e.message);
        } finally {
            setRollingBackId(null);
        }
    };

    if (loading) return <div>Loading history...</div>;
    if (error) return <div className="text-red-500">Error: {error}</div>;

    return (
        <div className="p-8 max-w-6xl mx-auto space-y-6">
            <h1 className="text-3xl font-bold">Import History</h1>
            <p className="text-gray-500">View all past imports and their statuses.</p>

            <div className="space-y-4">
                {history.length === 0 ? (
                    <div>No imports found.</div>
                ) : (
                    history.map(batch => (
                        <div key={batch.batchId} className="border p-4 rounded-xl space-y-2 bg-white shadow-sm">
                            <div className="flex justify-between items-start">
                                <div>
                                    <h3 className="font-semibold text-lg">{batch.filename}</h3>
                                    <div className="text-sm text-gray-500">
                                        Type: {batch.importType.toUpperCase()} | Status: <span className="font-medium text-black">{batch.status}</span>
                                    </div>
                                    <div className="text-sm text-gray-500">
                                        Uploaded: {new Date(batch.uploadedAt).toLocaleString()}
                                    </div>
                                </div>

                                {batch.status === "applied" && batch.rollbackEligibility && (
                                    <div className="text-right space-y-1">
                                        {batch.rollbackEligibility.eligible ? (
                                            <button
                                                onClick={() => handleRollback(batch.application.id)}
                                                disabled={rollingBackId === batch.application.id}
                                                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-50"
                                            >
                                                {rollingBackId === batch.application.id ? "Rolling back..." : "Roll Back"}
                                            </button>
                                        ) : (
                                            <div>
                                                <button disabled className="px-4 py-2 bg-gray-300 text-gray-500 text-sm font-medium rounded-md cursor-not-allowed">
                                                    Roll Back Unavailable
                                                </button>
                                                <div className="text-xs text-red-500 max-w-xs mt-1">
                                                    {batch.rollbackEligibility.blockedReason}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {batch.application && (
                                <div className="text-sm bg-gray-50 p-3 rounded mt-2 border">
                                    <div className="grid grid-cols-4 gap-4">
                                        <div>
                                            <span className="text-gray-500">Inserted:</span> {batch.application.insertedCount}
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Updated:</span> {batch.application.updatedCount}
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Skipped:</span> {batch.application.skippedCount}
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Failed:</span> {batch.application.failedCount}
                                        </div>
                                    </div>
                                    {batch.application.rolledBackAt && (
                                        <div className="mt-2 text-red-600">
                                            Rolled back on {new Date(batch.application.rolledBackAt).toLocaleString()}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
