"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";

interface EligibleCheckpoint {
    id: string;
    weekStart: string;
    weekEnd: string;
    generatedAt: string;
    sealedAt: string;
    cashAsOfDate: string;
    forecastVersionHash: string;
    isCurrent: boolean;
}

interface RiskMetrics {
    minCash: number;
    minCashWeek: string;
    firstNegativeWeek: string | null;
    maxDeficit: number;
    bufferHeadroom: number | null;
    firstBreachWeek: string | null;
}

interface RiskReview {
    checkpoint: EligibleCheckpoint & { cashSnapshotId: string };
    readiness: { status: string; reasons: string[]; evidenceHash: string };
    buffer: {
        amount: number | null;
        existingRationale: string | null;
        authoritative: boolean;
    };
    stressSummary: string[];
    baseMetrics: RiskMetrics;
    downsideMetrics: RiskMetrics;
    downsideScenario: { outsideHorizonAR: unknown[] };
    decisionAuthority: {
        forecastCheckpointId: string;
        forecastVersionHash: string;
        cashSnapshotId: string;
        readinessEvidenceHash: string;
        downsideScenarioId: string;
        downsideScenarioHash: string;
        bufferAssumptionId: string | null;
        bufferAmount: number | null;
    };
    eligibility: {
        status: "eligible" | "cannot_certify";
        canFinalizeDecision: boolean;
        canCertify: boolean;
        prerequisiteFailures: string[];
    };
}

const currency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
});

function formatDate(value: string) {
    return new Date(value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC"
    });
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unexpected error";
}

function MetricCard({ title, metrics }: { title: string; metrics: RiskMetrics }) {
    return (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">{title}</h3>
            <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">Lowest cash</dt>
                    <dd className="font-mono font-medium">{currency.format(metrics.minCash)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">Lowest-cash week</dt>
                    <dd>{formatDate(metrics.minCashWeek)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">Maximum deficit</dt>
                    <dd className="font-mono font-medium">{currency.format(metrics.maxDeficit)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                    <dt className="text-slate-600">Minimum buffer headroom</dt>
                    <dd className="font-mono font-medium">
                        {metrics.bufferHeadroom === null ? "Unavailable" : currency.format(metrics.bufferHeadroom)}
                    </dd>
                </div>
            </dl>
        </section>
    );
}

export default function CertificationReviewPage() {
    const router = useRouter();
    const [checkpoints, setCheckpoints] = useState<EligibleCheckpoint[]>([]);
    const [checkpointId, setCheckpointId] = useState("");
    const [stressInputs, setStressInputs] = useState({
        arDelayWeeks: 4,
        residualInflowReductionPct: 20
    });
    const [review, setReview] = useState<RiskReview | null>(null);
    const [finalDecision, setFinalDecision] = useState<{ status: string } | null>(null);
    const [rationale, setRationale] = useState("");
    const [bufferRationale, setBufferRationale] = useState("");
    const [loading, setLoading] = useState(false);
    const [loadingCheckpoints, setLoadingCheckpoints] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        fetch("/api/forecast-checkpoint/eligible")
            .then(async response => {
                const body = await response.json();
                if (!response.ok) throw new Error(body.error || "Unable to load sealed forecasts.");
                return body.checkpoints as EligibleCheckpoint[];
            })
            .then(eligible => {
                if (cancelled) return;
                setCheckpoints(eligible);
                const current = eligible.filter(checkpoint => checkpoint.isCurrent);
                if (current.length === 1) setCheckpointId(current[0].id);
                else if (eligible.length === 1) setCheckpointId(eligible[0].id);
            })
            .catch(fetchError => {
                if (!cancelled) setError(fetchError.message);
            })
            .finally(() => {
                if (!cancelled) setLoadingCheckpoints(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const changeCheckpoint = (value: string) => {
        setCheckpointId(value);
        setReview(null);
        setFinalDecision(null);
        setError("");
    };

    const changeStressInput = (field: keyof typeof stressInputs, value: number) => {
        setStressInputs(previous => ({ ...previous, [field]: value }));
        setReview(null);
        setFinalDecision(null);
        setError("");
    };

    const evaluateRisk = async () => {
        if (!checkpointId) {
            setError("Select the sealed forecast to review.");
            return;
        }

        setLoading(true);
        setError("");
        setFinalDecision(null);
        try {
            const response = await fetch("/api/forecast/certification/evaluate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ forecastCheckpointId: checkpointId, stressInputs })
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || "Forecast risk evaluation failed.");
            setReview(body.review);
        } catch (evaluationError: unknown) {
            setReview(null);
            setError(errorMessage(evaluationError));
        } finally {
            setLoading(false);
        }
    };

    const submitDecision = async (status: "certified" | "not_safe") => {
        if (!review) return;
        setLoading(true);
        setError("");
        try {
            const response = await fetch("/api/forecast/certification", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    forecastCheckpointId: checkpointId,
                    status,
                    rationale,
                    bufferRationale: status === "certified" ? bufferRationale : undefined,
                    stressInputs,
                    reviewedAuthority: review.decisionAuthority
                })
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error || "Forecast decision failed.");
            setFinalDecision(body.certification);
        } catch (decisionError: unknown) {
            setError(errorMessage(decisionError));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="sticky top-0 z-10 flex items-center gap-4 border-b bg-white px-6 py-4">
                <button
                    aria-label="Back"
                    onClick={() => router.back()}
                    className="text-slate-500 transition-colors hover:text-slate-900"
                >
                    <ArrowLeft className="h-5 w-5" />
                </button>
                <h1 className="text-xl font-semibold text-slate-800">Forecast Risk Review &amp; Certification</h1>
            </header>

            <main className="mx-auto w-full max-w-4xl space-y-6 p-8">
                <section className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
                    <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-slate-800">
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                        Evaluate the sealed forecast
                    </h2>
                    <p className="mb-6 text-sm text-slate-600">
                        Evaluate first. A final decision is recorded only after management reviews the governed risk results.
                    </p>

                    <div className="space-y-6">
                        <div>
                            <label htmlFor="forecast-checkpoint" className="mb-1 block text-sm font-medium text-slate-700">
                                Sealed forecast
                            </label>
                            <select
                                id="forecast-checkpoint"
                                value={checkpointId}
                                onChange={event => changeCheckpoint(event.target.value)}
                                disabled={loadingCheckpoints}
                                className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">
                                    {loadingCheckpoints ? "Loading sealed forecasts…" : "Select a sealed forecast"}
                                </option>
                                {checkpoints.map(checkpoint => (
                                    <option key={checkpoint.id} value={checkpoint.id}>
                                        {checkpoint.isCurrent ? "Current — " : ""}
                                        {formatDate(checkpoint.weekStart)} to {formatDate(checkpoint.weekEnd)} · cash as of {formatDate(checkpoint.cashAsOfDate)} · version {checkpoint.forecastVersionHash.slice(0, 10)}
                                    </option>
                                ))}
                            </select>
                            {!loadingCheckpoints && checkpoints.length === 0 ? (
                                <p className="mt-2 text-sm text-amber-700">No eligible sealed 13-week forecast is available.</p>
                            ) : null}
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <label htmlFor="ar-delay" className="mb-1 block text-sm font-medium text-slate-700">
                                    Stress AR delay (weeks)
                                </label>
                                <input
                                    id="ar-delay"
                                    type="number"
                                    min={0}
                                    max={13}
                                    step={1}
                                    value={stressInputs.arDelayWeeks}
                                    onChange={event => changeStressInput("arDelayWeeks", Number(event.target.value))}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label htmlFor="residual-reduction" className="mb-1 block text-sm font-medium text-slate-700">
                                    Residual inflow reduction (%)
                                </label>
                                <input
                                    id="residual-reduction"
                                    type="number"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={stressInputs.residualInflowReductionPct}
                                    onChange={event => changeStressInput("residualInflowReductionPct", Number(event.target.value))}
                                    className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        <button
                            onClick={evaluateRisk}
                            disabled={loading || !checkpointId}
                            className="rounded-md bg-slate-900 px-5 py-2.5 font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {loading ? "Evaluating…" : "Evaluate Forecast Risk"}
                        </button>
                    </div>

                    {error ? (
                        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
                            <strong>Error:</strong> {error}
                        </div>
                    ) : null}
                </section>

                {review ? (
                    <section className="space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
                        <div>
                            <h2 className="text-lg font-semibold text-slate-800">Governed risk evaluation</h2>
                            <p className="mt-1 text-sm text-slate-600">
                                Review these exact results before recording a forecast-version decision.
                            </p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <MetricCard title="Base forecast" metrics={review.baseMetrics} />
                            <MetricCard title="Downside stress" metrics={review.downsideMetrics} />
                        </div>

                        <div className="grid gap-4 rounded-lg bg-slate-50 p-5 text-sm sm:grid-cols-2">
                            <div>
                                <p className="font-semibold text-slate-700">Readiness</p>
                                <p className="mt-1 text-slate-600">{review.readiness.status}</p>
                            </div>
                            <div>
                                <p className="font-semibold text-slate-700">Authoritative live buffer</p>
                                <p className="mt-1 text-slate-600">
                                    {review.buffer.amount === null ? "Unavailable" : currency.format(review.buffer.amount)}
                                </p>
                            </div>
                            <div className="sm:col-span-2">
                                <p className="font-semibold text-slate-700">Stress applied</p>
                                <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-600">
                                    {review.stressSummary.map(item => <li key={item}>{item}</li>)}
                                </ul>
                            </div>
                            {review.downsideScenario.outsideHorizonAR.length > 0 ? (
                                <p className="sm:col-span-2 text-amber-700">
                                    {review.downsideScenario.outsideHorizonAR.length} delayed AR item(s) move beyond W13 and are preserved in scenario evidence.
                                </p>
                            ) : null}
                        </div>

                        {!review.eligibility.canFinalizeDecision ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                                <p className="font-semibold">Cannot certify</p>
                                <ul className="mt-2 list-disc space-y-1 pl-5">
                                    {review.eligibility.prerequisiteFailures.map(reason => <li key={reason}>{reason}</li>)}
                                </ul>
                            </div>
                        ) : (
                            <div className="space-y-5 border-t border-slate-200 pt-6">
                                <div>
                                    <label htmlFor="decision-rationale" className="mb-1 block text-sm font-medium text-slate-700">
                                        Management decision rationale
                                    </label>
                                    <textarea
                                        id="decision-rationale"
                                        value={rationale}
                                        onChange={event => setRationale(event.target.value)}
                                        placeholder="Explain why this forecast is or is not safe for real cash decisions."
                                        className="h-24 w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div>
                                    <label htmlFor="buffer-rationale" className="mb-1 block text-sm font-medium text-slate-700">
                                        Buffer rationale required for certification
                                    </label>
                                    <textarea
                                        id="buffer-rationale"
                                        value={bufferRationale}
                                        onChange={event => setBufferRationale(event.target.value)}
                                        placeholder="Explain why the live buffer amount is appropriate for this decision."
                                        className="h-20 w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div className="flex flex-wrap justify-end gap-3">
                                    <button
                                        onClick={() => submitDecision("not_safe")}
                                        disabled={loading || !rationale.trim() || Boolean(finalDecision)}
                                        className="flex items-center gap-2 rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <ShieldAlert className="h-4 w-4" />
                                        Mark Not Safe
                                    </button>
                                    <button
                                        onClick={() => submitDecision("certified")}
                                        disabled={loading || !bufferRationale.trim() || Boolean(finalDecision)}
                                        className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <ShieldCheck className="h-4 w-4" />
                                        Certify for Decision Use
                                    </button>
                                </div>
                            </div>
                        )}

                        {finalDecision ? (
                            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                                Final forecast-version decision recorded: <strong>{finalDecision.status}</strong>
                            </div>
                        ) : null}
                    </section>
                ) : null}
            </main>
        </div>
    );
}
