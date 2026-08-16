'use client';

import { useState, useEffect } from 'react';

type BankEvidence = {
    accounts: Array<{ id: string; name: string | null; role: string }>;
    manifests: Array<{
        id: string;
        userCertified: boolean;
        createdAt: string;
        BankImportManifestAccount: Array<{
            bankAccountId: string;
            coveredStartDate: string | null;
            coveredEndDate: string | null;
            userCertifiedAt: string | null;
        }>;
    }>;
};

export default function ReadinessPage() {
    const [readiness, setReadiness] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [bankEvidence, setBankEvidence] = useState<BankEvidence | null>(null);
    const [selectedAccountId, setSelectedAccountId] = useState('');
    const [coveredStartDate, setCoveredStartDate] = useState('');
    const [coveredEndDate, setCoveredEndDate] = useState('');
    const [noActivityConfirmed, setNoActivityConfirmed] = useState(false);
    const [bankActionError, setBankActionError] = useState<string | null>(null);
    const [bankActionSaving, setBankActionSaving] = useState(false);

    const refreshReadiness = async () => {
        const [readinessResponse, bankEvidenceResponse] = await Promise.all([
            fetch('/api/readiness'),
            fetch('/api/readiness/bank-evidence')
        ]);
        setReadiness(await readinessResponse.json());
        if (bankEvidenceResponse.ok) {
            const evidence = await bankEvidenceResponse.json();
            setBankEvidence(evidence);
            setSelectedAccountId(current => current || evidence.accounts[0]?.id || '');
        }
        setLoading(false);
    };

    useEffect(() => {
        refreshReadiness()
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
        await refreshReadiness();
    };

    const certifyManifest = async (manifestId: string) => {
        setBankActionSaving(true);
        setBankActionError(null);
        try {
            const response = await fetch('/api/readiness/bank-manifest/certify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ manifestId })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to certify bank manifest');
            await refreshReadiness();
        } catch (error) {
            setBankActionError(error instanceof Error ? error.message : 'Unable to certify bank manifest');
        } finally {
            setBankActionSaving(false);
        }
    };

    const attestNoActivity = async () => {
        if (!selectedAccountId || !coveredStartDate || !coveredEndDate || !noActivityConfirmed) {
            setBankActionError('Choose an account, enter both exact interval boundaries, and confirm no activity.');
            return;
        }

        const start = new Date(coveredStartDate);
        const end = new Date(coveredEndDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
            setBankActionError('Enter a valid interval with an end at or after the start.');
            return;
        }

        setBankActionSaving(true);
        setBankActionError(null);
        try {
            const response = await fetch('/api/readiness/attest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scopeType: 'bank_no_activity',
                    scopeKey: selectedAccountId,
                    asOfDate: end.toISOString(),
                    evidenceJson: JSON.stringify({ coveredStartDate: start.toISOString(), coveredEndDate: end.toISOString() })
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Unable to record no-activity evidence');
            setNoActivityConfirmed(false);
            await refreshReadiness();
        } catch (error) {
            setBankActionError(error instanceof Error ? error.message : 'Unable to record no-activity evidence');
        } finally {
            setBankActionSaving(false);
        }
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

            {readiness?.dimensions?.bankCoverage?.status !== 'decision_ready' && (
                <section className="mt-8 border rounded p-4 space-y-5">
                    <div>
                        <h2 className="font-semibold">Account-level bank evidence</h2>
                        <p className="text-sm text-gray-600">Certify an uploaded, successful manifest separately from a no-activity assertion.</p>
                    </div>

                    <div className="space-y-3">
                        <h3 className="font-medium">Certify uploaded manifest</h3>
                        {bankEvidence?.manifests.filter(manifest => !manifest.userCertified).map(manifest => (
                            <div key={manifest.id} className="border rounded p-3 flex flex-wrap items-center justify-between gap-3">
                                <div className="text-sm">
                                    <p className="font-medium">Manifest {manifest.id}</p>
                                    {manifest.BankImportManifestAccount.map(account => {
                                        const accountName = bankEvidence.accounts.find(item => item.id === account.bankAccountId)?.name || account.bankAccountId;
                                        return <p key={account.bankAccountId} className="text-gray-600">{accountName}: {account.coveredStartDate || 'unknown'} to {account.coveredEndDate || 'unknown'}</p>;
                                    })}
                                </div>
                                <button
                                    disabled={bankActionSaving}
                                    onClick={() => certifyManifest(manifest.id)}
                                    className="px-3 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
                                >
                                    Certify uploaded manifest
                                </button>
                            </div>
                        ))}
                        {bankEvidence && bankEvidence.manifests.filter(manifest => !manifest.userCertified).length === 0 && (
                            <p className="text-sm text-gray-600">No successful uncertified manifests are available for this tenant.</p>
                        )}
                    </div>

                    <div className="space-y-3 border-t pt-4">
                        <h3 className="font-medium">Attest no bank activity</h3>
                        <div className="grid gap-3 sm:grid-cols-3">
                            <label className="text-sm">Account
                                <select value={selectedAccountId} onChange={event => setSelectedAccountId(event.target.value)} className="mt-1 block w-full border rounded p-2">
                                    {bankEvidence?.accounts.map(account => <option key={account.id} value={account.id}>{account.name || account.id} ({account.role})</option>)}
                                </select>
                            </label>
                            <label className="text-sm">Covered start
                                <input type="datetime-local" value={coveredStartDate} onChange={event => setCoveredStartDate(event.target.value)} className="mt-1 block w-full border rounded p-2" />
                            </label>
                            <label className="text-sm">Covered end
                                <input type="datetime-local" value={coveredEndDate} onChange={event => setCoveredEndDate(event.target.value)} className="mt-1 block w-full border rounded p-2" />
                            </label>
                        </div>
                        <label className="flex gap-2 text-sm items-start">
                            <input type="checkbox" checked={noActivityConfirmed} onChange={event => setNoActivityConfirmed(event.target.checked)} className="mt-1" />
                            <span>I confirm that management is asserting no bank activity for this exact account and interval.</span>
                        </label>
                        <button disabled={bankActionSaving} onClick={attestNoActivity} className="px-3 py-2 bg-slate-700 text-white rounded disabled:opacity-50">
                            Record no-activity evidence
                        </button>
                    </div>

                    {bankActionError && <p role="alert" className="text-sm text-red-700">{bankActionError}</p>}
                </section>
            )}
        </div>
    );
}
