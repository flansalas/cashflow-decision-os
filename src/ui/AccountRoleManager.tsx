"use client";

import { useState, useEffect } from "react";

export function AccountRoleManager() {
    const [accounts, setAccounts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`/api/company/accounts`)
            .then(r => r.json())
            .then(d => {
                if (d.accounts) setAccounts(d.accounts);
                setLoading(false);
            })
            .catch(console.error);
    }, []);

    const updateRole = async (accountId: string, role: string) => {
        try {
            const res = await fetch(`/api/company/accounts/${accountId}/role`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ role })
            });
            if (!res.ok) throw new Error("Server rejected role update");
            
            setAccounts(accs => accs.map(a => a.id === accountId ? { ...a, role } : a));
        } catch (e) {
            console.error("Failed to update role", e);
            // Optionally could add a toast here. But we definitely don't update local state on failure.
        }
    };

    if (loading) return null;
    if (accounts.length === 0) return null;

    return (
        <div className="bg-white rounded-2xl shadow-sm border p-6 mt-6" style={{ borderColor: "var(--border-subtle)" }}>
            <h3 className="text-base font-bold mb-4" style={{ color: "var(--text-primary)" }}>Bank Accounts</h3>
            <div className="space-y-3">
                {accounts.map(acc => (
                    <div key={acc.id} className="flex items-center justify-between p-3 rounded-lg border" style={{ borderColor: "var(--border-subtle)", background: "var(--bg-raised)" }}>
                        <div>
                            <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{acc.name}</div>
                            <div className="text-xs" style={{ color: "var(--text-muted)" }}>{acc.isActive ? "Active" : "Inactive"}</div>
                        </div>
                        <select 
                            value={acc.role || "operating"} 
                            onChange={e => updateRole(acc.id, e.target.value)}
                            className="border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-slate-400"
                            style={{ background: "var(--bg-input)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
                        >
                            <option value="operating">Operating</option>
                            <option value="payroll">Payroll</option>
                        </select>
                    </div>
                ))}
            </div>
            <p className="text-xs mt-4" style={{ color: "var(--text-muted)" }}>
                Setting an account to <strong>Payroll</strong> ensures its activity is excluded from variable operating cash when an explicit payroll forecast exists.
            </p>
        </div>
    );
}
