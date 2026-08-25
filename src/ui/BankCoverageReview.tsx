"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Landmark, Loader2, Upload } from "lucide-react";

type BankAccountEvidence = {
    id: string;
    name: string | null;
    role: string;
};

type ManifestAccountEvidence = {
    bankAccountId: string;
    coveredStartDate: string | null;
    coveredEndDate: string | null;
    userCertifiedAt: string | null;
};

type BankManifestEvidence = {
    id: string;
    userCertified: boolean;
    createdAt: string;
    BankImportManifestAccount: ManifestAccountEvidence[];
};

type BankEvidenceResponse = {
    accounts: BankAccountEvidence[];
    manifests: BankManifestEvidence[];
};

export type BankCoverageStatus = {
    hasData: boolean;
    rowCount: number;
    isVerified: boolean;
    coverageDetails: {
        uncoveredAccountIds: string[];
    } | null;
};

type CoverageInterval = {
    start: Date;
    end: Date;
};

type Props = {
    companyId: string;
    weekStart?: string;
    weekEnd?: string;
    onBackToUpload: () => void;
    onContinue: (status: BankCoverageStatus) => void;
};

function validDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function manifestInterval(startValue: string | null, endValue: string | null): CoverageInterval | null {
    const start = validDate(startValue);
    const end = validDate(endValue);
    if (!start || !end || start > end) return null;

    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);
    return { start, end };
}

function overlaps(interval: CoverageInterval, requiredStart: Date, requiredEnd: Date): boolean {
    return interval.start <= requiredEnd && interval.end >= requiredStart;
}

export function findMissingCoverageIntervals(
    manifests: BankManifestEvidence[],
    accountId: string,
    weekStart: string,
    weekEnd: string
): CoverageInterval[] {
    const requiredStart = validDate(weekStart);
    const requiredEnd = validDate(weekEnd);
    if (!requiredStart || !requiredEnd || requiredStart > requiredEnd) return [];

    const intervals = manifests.flatMap(manifest => {
        if (!manifest.userCertified) return [];
        return manifest.BankImportManifestAccount.flatMap(account => {
            if (account.bankAccountId !== accountId || !account.userCertifiedAt) return [];
            const interval = manifestInterval(account.coveredStartDate, account.coveredEndDate);
            if (!interval || !overlaps(interval, requiredStart, requiredEnd)) return [];
            return [{
                start: new Date(Math.max(interval.start.getTime(), requiredStart.getTime())),
                end: new Date(Math.min(interval.end.getTime(), requiredEnd.getTime())),
            }];
        });
    }).sort((a, b) => a.start.getTime() - b.start.getTime());

    if (intervals.length === 0) {
        return [{ start: requiredStart, end: requiredEnd }];
    }

    const merged: CoverageInterval[] = [];
    for (const interval of intervals) {
        const current = merged[merged.length - 1];
        if (!current || interval.start.getTime() > current.end.getTime() + 1) {
            merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
        } else if (interval.end > current.end) {
            current.end = new Date(interval.end);
        }
    }

    const missing: CoverageInterval[] = [];
    let cursor = requiredStart.getTime();
    for (const interval of merged) {
        if (interval.start.getTime() > cursor) {
            missing.push({ start: new Date(cursor), end: new Date(interval.start.getTime() - 1) });
        }
        cursor = Math.max(cursor, interval.end.getTime() + 1);
    }
    if (cursor <= requiredEnd.getTime()) {
        missing.push({ start: new Date(cursor), end: requiredEnd });
    }

    return missing;
}

function intervalLabel(interval: CoverageInterval): string {
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
    const start = interval.start.toLocaleDateString("en-US", options);
    const end = interval.end.toLocaleDateString("en-US", options);
    return start === end ? start : `${start}–${end}`;
}

function manifestOverlapsWeek(
    manifest: BankManifestEvidence,
    accountId: string,
    weekStart: string,
    weekEnd: string
): boolean {
    const requiredStart = validDate(weekStart);
    const requiredEnd = validDate(weekEnd);
    if (!requiredStart || !requiredEnd) return false;

    return manifest.BankImportManifestAccount.some(account => {
        if (account.bankAccountId !== accountId) return false;
        const interval = manifestInterval(account.coveredStartDate, account.coveredEndDate);
        return interval ? overlaps(interval, requiredStart, requiredEnd) : false;
    });
}

async function responseJson<T = unknown>(response: Response): Promise<T> {
    const data: unknown = await response.json().catch(() => ({}));
    const message = typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
        ? data.error
        : "Unable to update bank coverage";
    if (!response.ok) throw new Error(message);
    return data as T;
}

export function BankCoverageReview({ companyId, weekStart, weekEnd, onBackToUpload, onContinue }: Props) {
    const [evidence, setEvidence] = useState<BankEvidenceResponse | null>(null);
    const [status, setStatus] = useState<BankCoverageStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [savingKey, setSavingKey] = useState<string | null>(null);
    const [confirmedAccounts, setConfirmedAccounts] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async (): Promise<BankCoverageStatus | null> => {
        if (!weekStart || !weekEnd) {
            setLoading(false);
            setError("The closing-week boundaries are unavailable. Return to the roll and try again.");
            return null;
        }

        setLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ companyId, weekStart, weekEnd });
            const [evidenceResponse, statusResponse] = await Promise.all([
                fetch("/api/readiness/bank-evidence"),
                fetch(`/api/upload/bank/status?${params}`),
            ]);
            const [nextEvidence, nextStatus] = await Promise.all([
                responseJson<BankEvidenceResponse>(evidenceResponse),
                responseJson<BankCoverageStatus>(statusResponse),
            ]);
            setEvidence(nextEvidence);
            setStatus(nextStatus);
            return nextStatus;
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : "Unable to load bank coverage");
            return null;
        } finally {
            setLoading(false);
        }
    }, [companyId, weekEnd, weekStart]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const uncoveredAccountIds = useMemo(
        () => new Set(status?.coverageDetails?.uncoveredAccountIds ?? []),
        [status?.coverageDetails?.uncoveredAccountIds]
    );

    const certifyManifest = async (manifestId: string) => {
        setSavingKey(`manifest:${manifestId}`);
        setError(null);
        try {
            const response = await fetch("/api/readiness/bank-manifest/certify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ manifestId }),
            });
            await responseJson(response);
            await refresh();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Unable to certify the uploaded statement");
        } finally {
            setSavingKey(null);
        }
    };

    const attestNoActivity = async (account: BankAccountEvidence, intervals: CoverageInterval[]) => {
        if (!confirmedAccounts[account.id] || intervals.length === 0) return;
        setSavingKey(`account:${account.id}`);
        setError(null);
        try {
            await Promise.all(intervals.map(async interval => {
                const response = await fetch("/api/readiness/attest", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        scopeType: "bank_no_activity",
                        scopeKey: account.id,
                        asOfDate: interval.end.toISOString(),
                        evidenceJson: JSON.stringify({
                            coveredStartDate: interval.start.toISOString(),
                            coveredEndDate: interval.end.toISOString(),
                        }),
                    }),
                });
                await responseJson(response);
            }));
            setConfirmedAccounts(current => ({ ...current, [account.id]: false }));
            await refresh();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "Unable to record no-activity evidence");
        } finally {
            setSavingKey(null);
        }
    };

    const fallbackStatus: BankCoverageStatus = {
        hasData: false,
        rowCount: 0,
        isVerified: false,
        coverageDetails: null,
    };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                <div className="flex items-start gap-3">
                    <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />
                    <div>
                        <p className="text-sm font-semibold text-slate-900">Confirm every active cash account</p>
                        <p className="mt-1 text-xs text-slate-600">
                            Certify uploaded activity and confirm no activity only for the exact uncovered periods. The app will not learn until every account is covered.
                        </p>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" /> Checking account coverage…
                </div>
            ) : evidence?.accounts.length ? (
                <div className="space-y-3">
                    {evidence.accounts.map(account => {
                        const isCovered = status?.coverageDetails ? !uncoveredAccountIds.has(account.id) : false;
                        const relevantManifests = weekStart && weekEnd
                            ? evidence.manifests.filter(manifest => manifestOverlapsWeek(manifest, account.id, weekStart, weekEnd))
                            : [];
                        const uncertifiedManifests = relevantManifests.filter(manifest => !manifest.userCertified);
                        const missingIntervals = weekStart && weekEnd
                            ? findMissingCoverageIntervals(evidence.manifests, account.id, weekStart, weekEnd)
                            : [];
                        const accountName = account.name || account.id;

                        return (
                            <div key={account.id} className={`rounded-xl border p-4 ${isCovered ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <p className="text-sm font-semibold text-slate-900">{accountName}</p>
                                        <p className="text-xs capitalize text-slate-500">{account.role}</p>
                                    </div>
                                    {isCovered ? (
                                        <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                                            <CheckCircle2 className="h-4 w-4" /> Covered
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1 text-xs font-semibold text-amber-700">
                                            <AlertTriangle className="h-4 w-4" /> Needs confirmation
                                        </span>
                                    )}
                                </div>

                                {!isCovered && uncertifiedManifests.length > 0 && (
                                    <div className="mt-3 space-y-2">
                                        {uncertifiedManifests.map(manifest => {
                                            const interval = manifest.BankImportManifestAccount
                                                .filter(item => item.bankAccountId === account.id)
                                                .map(item => manifestInterval(item.coveredStartDate, item.coveredEndDate))
                                                .find((item): item is CoverageInterval => item !== null);
                                            return (
                                                <button
                                                    key={manifest.id}
                                                    type="button"
                                                    disabled={savingKey !== null}
                                                    onClick={() => certifyManifest(manifest.id)}
                                                    className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-left text-xs font-semibold text-indigo-700 disabled:opacity-50"
                                                >
                                                    Certify uploaded statement{interval ? ` (${intervalLabel(interval)})` : ""} for {accountName}
                                                </button>
                                            );
                                        })}
                                        <p className="text-[11px] text-slate-500">Certify the uploaded file first; any remaining zero-activity periods will appear next.</p>
                                    </div>
                                )}

                                {!isCovered && uncertifiedManifests.length === 0 && missingIntervals.length > 0 && (
                                    <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
                                        <p className="text-xs text-slate-600">
                                            Uncovered period{missingIntervals.length === 1 ? "" : "s"}: {missingIntervals.map(intervalLabel).join(" and ")}.
                                        </p>
                                        <label className="flex items-start gap-2 text-xs text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={confirmedAccounts[account.id] ?? false}
                                                onChange={event => setConfirmedAccounts(current => ({ ...current, [account.id]: event.target.checked }))}
                                                className="mt-0.5"
                                            />
                                            <span>I checked {accountName} and confirm there were no transactions during the uncovered period{missingIntervals.length === 1 ? "" : "s"}.</span>
                                        </label>
                                        <button
                                            type="button"
                                            disabled={savingKey !== null || !confirmedAccounts[account.id]}
                                            onClick={() => attestNoActivity(account, missingIntervals)}
                                            className="w-full rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                                        >
                                            Confirm no activity for {accountName}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                    No active bank accounts were found. Bank coverage cannot be verified.
                </div>
            )}

            {status?.isVerified && (
                <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800" role="status">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                    Every active account is covered. This week is eligible for verified accuracy and learning.
                </div>
            )}

            {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700" role="alert">{error}</p>}

            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <button
                    type="button"
                    onClick={onBackToUpload}
                    className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600"
                >
                    <Upload className="h-4 w-4" /> Upload another statement
                </button>
                <button
                    type="button"
                    disabled={loading || savingKey !== null}
                    onClick={() => onContinue(status ?? fallbackStatus)}
                    className={`min-w-[220px] flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40 ${status?.isVerified ? "bg-emerald-600" : "bg-indigo-600"}`}
                >
                    {status?.isVerified ? "Continue — Coverage Verified" : "Continue Unverified"}
                </button>
            </div>
        </div>
    );
}
