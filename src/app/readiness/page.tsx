'use client';

import { useState, useEffect } from 'react';

export default function ReadinessPage() {
    const [readiness, setReadiness] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/readiness')
            .then(res => res.json())
            .then(data => {
                setReadiness(data);
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    const handleAttest = async (scopeType: string) => {
        const payload = {
            scopeType,
            asOfDate: new Date().toISOString(),
            evidenceJson: JSON.stringify({ manual: true })
        };

        await fetch('/api/readiness/attest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Refresh
        const res = await fetch('/api/readiness');
        const data = await res.json();
        setReadiness(data);
    };

    if (loading) return <div className="p-8">Loading readiness...</div>;

    return (
        <div className="p-8 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold mb-6">Company Data Readiness Certification</h1>
            
            <div className={`p-4 rounded mb-8 ${readiness?.status === 'decision_ready' ? 'bg-green-100 text-green-800' : readiness?.status === 'blocked' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                <strong>Overall Status:</strong> {readiness?.status?.toUpperCase()}
            </div>

            <div className="space-y-4">
                {['accountsReceivable', 'accountsPayable', 'recurringPatterns', 'bankCoverage'].map(dim => {
                    const status = readiness?.dimensions?.[dim]?.status;
                    return (
                        <div key={dim} className="border p-4 rounded flex justify-between items-center">
                            <div>
                                <h3 className="font-semibold capitalize">{dim.replace(/([A-Z])/g, ' $1')}</h3>
                                <p className="text-sm text-gray-600">Status: {status}</p>
                                <p className="text-sm text-gray-500">{readiness?.dimensions?.[dim]?.detail}</p>
                            </div>
                            {dim === 'bankCoverage' && status !== 'decision_ready' ? (
                                <p className="text-sm text-gray-600 text-right">
                                    Requires account-level bank evidence
                                </p>
                            ) : status !== 'decision_ready' && status !== 'blocked' && (
                                <button 
                                    onClick={() => handleAttest(dim === 'accountsReceivable' ? 'ar' : dim === 'accountsPayable' ? 'ap' : 'recurring')}
                                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                                >
                                    Certify Now
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
