"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function ReviewBatchPage() {
    const params = useParams();
    const router = useRouter();
    const batchId = params.id as string;

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    const loadData = async () => {
        try {
            const res = await fetch(`/api/upload/review?batchId=${batchId}`);
            if (res.ok) {
                setData(await res.json());
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [batchId]);

    const handleDecision = async (rowId: string, decision: string, linkedRecordId?: string) => {
        await fetch(`/api/upload/decide`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rowId, decision, linkedRecordId })
        });
        loadData();
    };

    const handleBulk = async (action: string) => {
        await fetch(`/api/upload/decide`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bulkAction: true, batchId, action })
        });
        loadData();
    };

    const handleApply = async () => {
        setLoading(true);
        const res = await fetch(`/api/upload/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ importBatchId: batchId })
        });
        const d = await res.json();
        if (res.ok) {
            alert(`Applied successfully! Inserted: ${d.insertedCount}, Updated: ${d.updatedCount}, Skipped: ${d.skippedCount}`);
            loadData();
        } else {
            alert(`Failed: ${d.error}`);
            setLoading(false);
        }
    };

    if (loading) return <div className="p-8">Loading...</div>;
    if (!data) return <div className="p-8">Batch not found</div>;

    const { summary, rows } = data;

    return (
        <div className="p-8 max-w-7xl mx-auto space-y-8">
            <div>
                <h1 className="text-2xl font-bold mb-4">Review Import Batch</h1>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 border rounded-md bg-gray-50 dark:bg-gray-800">
                    <div><strong>Type:</strong> {summary.importType}</div>
                    <div><strong>File:</strong> {summary.filename}</div>
                    <div><strong>Uploaded:</strong> {new Date(summary.uploadedAt).toLocaleString()}</div>
                    <div><strong>Status:</strong> <span className="font-semibold text-blue-600">{summary.reviewStatus}</span></div>

                    <div><strong>Total:</strong> {summary.totalRows}</div>
                    <div><strong>New:</strong> {summary.newRows}</div>
                    <div><strong>Duplicates:</strong> {summary.exactDuplicates}</div>
                    <div><strong>Changed:</strong> {summary.changedExisting}</div>
                    <div><strong>Possible Matches:</strong> {summary.possibleMatches}</div>
                    <div><strong>Invalid:</strong> {summary.invalidRows}</div>
                </div>

                <div className="mt-4 flex gap-4">
                    <button
                        onClick={() => handleBulk("skip_exact_duplicates")}
                        className="px-4 py-2 border rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                        disabled={summary.reviewStatus === "applied"}
                    >
                        Skip Exact Duplicates
                    </button>
                    <button
                        onClick={() => handleBulk("accept_new_valid")}
                        className="px-4 py-2 border rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 text-blue-600 border-blue-600"
                        disabled={summary.reviewStatus === "applied"}
                    >
                        Accept All New Valid
                    </button>
                    {summary.reviewStatus === "ready_to_apply" && (
                        <button
                            onClick={handleApply}
                            className="px-4 py-2 bg-green-600 text-white rounded-md font-bold ml-auto"
                        >
                            Apply Import
                        </button>
                    )}
                </div>
            </div>

            <div className="space-y-4">
                <h2 className="text-xl font-bold">Staged Rows</h2>
                {rows.map((row: any) => (
                    <div key={row.id} className="border p-4 rounded-md shadow-sm">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <span className="font-bold text-gray-500 mr-2">#{row.sourceRowNumber}</span>
                                <span className="inline-block px-2 py-1 text-xs font-semibold rounded bg-gray-200 dark:bg-gray-700">
                                    {row.conflictType}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                {row.userDecision ? (
                                    <span className="text-green-600 font-bold">Decision: {row.userDecision}</span>
                                ) : (
                                    <span className="text-yellow-600 font-bold italic">Needs Decision</span>
                                )}
                            </div>
                        </div>

                        <div className="text-sm space-y-1 mb-4">
                            <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded overflow-x-auto">
                                {JSON.stringify(row.normalizedValues, null, 2)}
                            </pre>
                        </div>

                        {row.validationErrors?.length > 0 && (
                            <div className="text-red-500 text-sm mb-4">
                                <strong>Errors:</strong> {row.validationErrors.join(", ")}
                            </div>
                        )}

                        {row.fieldDifferences && (
                            <div className="text-sm mb-4 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded">
                                <strong>Changed Fields:</strong>
                                <ul className="list-disc list-inside">
                                    {row.fieldDifferences.map((d: any, i: number) => (
                                        <li key={i}>
                                            <span className="font-semibold">{d.field}</span>:
                                            <span className="line-through text-red-500 ml-1">{d.existing}</span> &rarr;
                                            <span className="text-green-500 ml-1">{d.imported}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {row.linkedRecordId && (
                            <div className="text-sm mb-4 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-blue-800">
                                <strong>Linked Record:</strong> {row.linkedRecordId}
                            </div>
                        )}

                        <div className="flex flex-wrap gap-2 mt-4 items-center">
                            {!row.userDecision && row.conflictType === "new" && (
                                <>
                                    <button onClick={() => handleDecision(row.id, "accept_insert")} className="btn-primary px-3 py-1 bg-blue-600 text-white rounded">Accept Insert</button>
                                    <button onClick={() => handleDecision(row.id, "skip")} className="btn-secondary px-3 py-1 border rounded">Skip</button>
                                </>
                            )}
                            {!row.userDecision && row.conflictType === "exact_duplicate" && (
                                <button onClick={() => handleDecision(row.id, "skip")} className="btn-secondary px-3 py-1 border rounded">Skip Duplicate</button>
                            )}
                            {!row.userDecision && row.conflictType === "changed_existing" && (
                                <>
                                    <button onClick={() => handleDecision(row.id, "accept_update")} className="btn-primary px-3 py-1 bg-blue-600 text-white rounded">Accept Update</button>
                                    <button onClick={() => handleDecision(row.id, "keep_existing")} className="btn-secondary px-3 py-1 border rounded">Keep Existing</button>
                                    <button onClick={() => handleDecision(row.id, "skip")} className="btn-secondary px-3 py-1 border rounded">Skip Row</button>
                                </>
                            )}
                            {!row.userDecision && (row.conflictType === "possible_match" || row.conflictType === "possible_duplicate") && (
                                <>
                                    {row.conflictType === "possible_match" ? (
                                        <div className="flex items-center gap-2">
                                            <select
                                                id={`link-select-${row.id}`}
                                                className="border rounded px-2 py-1"
                                                defaultValue=""
                                            >
                                                <option value="" disabled>Select record to link...</option>
                                                {row.candidates?.map((c: any) => (
                                                    <option key={c.id} value={c.id}>
                                                        {c.invoiceNo || c.billNo} - {c.customerName || c.vendorName} ({c.amountOpen})
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => {
                                                    const sel = document.getElementById(`link-select-${row.id}`) as HTMLSelectElement;
                                                    if (sel && sel.value) handleDecision(row.id, "link_and_review", sel.value);
                                                    else alert("Please select a record first");
                                                }}
                                                className="btn-primary px-3 py-1 bg-blue-600 text-white rounded"
                                            >
                                                Link & Review
                                            </button>
                                        </div>
                                    ) : (
                                        <button onClick={() => handleDecision(row.id, "accept_insert")} className="btn-primary px-3 py-1 bg-blue-600 text-white rounded">
                                            Accept Insert
                                        </button>
                                    )}

                                    {row.conflictType === "possible_match" && (
                                        <button onClick={() => handleDecision(row.id, "treat_as_new")} className="btn-secondary px-3 py-1 border rounded">Treat as New</button>
                                    )}
                                    <button onClick={() => handleDecision(row.id, "skip")} className="btn-secondary px-3 py-1 border rounded">Skip</button>
                                </>
                            )}
                            {!row.userDecision && row.conflictType === "invalid" && (
                                <button onClick={() => handleDecision(row.id, "skip")} className="btn-secondary px-3 py-1 border rounded text-red-600 border-red-600">Skip Invalid</button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
