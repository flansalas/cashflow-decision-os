// ui/ARAPUploadStep.tsx – 3-phase Upload → Mapping → Preview → Done
// Integrates with /api/upload/ar, /api/upload/ap, /api/upload/mapping
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Upload, FolderOpen, FileSpreadsheet, Search, CheckCircle, CheckCircle2, ArrowRight, ArrowLeft, AlertTriangle, Pencil } from "lucide-react";
import { parseFile, ParsedFile } from "@/services/parseFile";
import {
    AR_FIELDS, AP_FIELDS, FieldDef,
    autoDetect,
    applyARMapping, applyAPMapping,
    NormalizedARRow, NormalizedAPRow,
    arSummary, apSummary,
} from "@/services/columnMapper";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
    companyId: string;
    onDone: () => void; // called after import or skip
}

type Phase = "upload" | "mapping" | "preview" | "done";

interface FileState {
    parsed: ParsedFile | null;
    mapping: Record<string, string>;
    savedMappingLoaded: boolean;
    error: string | null;
    loading: boolean;
}

const emptyFile = (): FileState => ({
    parsed: null,
    mapping: {},
    savedMappingLoaded: false,
    error: null,
    loading: false,
});

interface ImportResult {
    ar?: { imported: number; updated: number; deleted: number; total: number };
    ap?: { imported: number; updated: number; deleted: number; total: number };
}

function fmt(n: number) {
    return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">{icon}</span>
            <div>
                <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] mb-0.5" style={{ color: "var(--text-muted)" }}>{title}</h4>
                {sub && <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{sub}</p>}
            </div>
        </div>
    );
}

function Dropzone({
    label, icon, file, onFiles, error, loading,
}: {
    label: string; icon: React.ReactNode; file: ParsedFile | null;
    onFiles: (files: File[]) => void; error: string | null; loading: boolean;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [dragging, setDragging] = useState(false);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const fs = Array.from(e.dataTransfer.files);
        if (fs.length > 0) onFiles(fs);
    }, [onFiles]);

    return (
        <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl p-7 cursor-pointer transition-all text-center
        ${dragging ? "border-slate-400 bg-slate-50" : "border-slate-200 hover:border-slate-300 bg-slate-50/30"} shadow-sm`}
            style={{ background: dragging ? undefined : "var(--bg-raised)", borderColor: dragging ? undefined : "var(--border-subtle)" }}
        >
            <input
                ref={inputRef}
                type="file"
                multiple
                accept=".csv,.xlsx,.xls,.pdf"
                className="hidden"
                onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length > 0) onFiles(fs); }}
            />
            {loading ? (
                <div className="flex items-center justify-center gap-2 text-gray-400">
                    <span className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
                    Parsing…
                </div>
            ) : file ? (
                <div className="space-y-1">
                    <div className="text-emerald-700 font-medium text-sm">{icon} {label}</div>
                    <div className="text-xs font-mono truncate" style={{ color: "var(--text-secondary)" }}>{file.fileName}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>{file.rowCount.toLocaleString()} rows · {file.headers.length} columns</div>
                    <div className="text-xs text-emerald-600 mt-1">Click to replace</div>
                </div>
            ) : (
                <div className="space-y-1">
                    <div className="text-2xl">{icon}</div>
                    <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>Drag & drop or click · CSV, XLSX, or PDF</div>
                </div>
            )}
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
    );
}

function MappingPanel({
    title, icon, fields, headers, mapping, onChange,
}: {
    title: string; icon: React.ReactNode; fields: FieldDef[];
    headers: string[]; mapping: Record<string, string>;
    onChange: (key: string, value: string) => void;
}) {
    return (
        <div className="rounded-xl border p-4 space-y-3" style={{ background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>
            <SectionHeader icon={icon} title={title} />
            {fields.map(field => (
                <div key={field.key} className="flex items-center gap-3">
                    <div className="w-36 shrink-0">
                        <span className="text-xs text-gray-400">
                            {field.label}
                            {field.required && <span className="text-red-400 ml-0.5">*</span>}
                        </span>
                    </div>
                    <select
                        value={mapping[field.key] ?? ""}
                        onChange={e => onChange(field.key, e.target.value)}
                        className="flex-1 border rounded-xl px-4 py-2 text-sm outline-none transition-all duration-200 focus:border-slate-400 focus:ring-4 focus:ring-slate-900/5 appearance-none bg-[url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2220%22%20height%3D%2220%22%20viewBox%3D%220%200%2020%2020%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M5%207L10%2012L15%207%22%20stroke%3D%22%2364748B%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3C/svg%3E')] bg-[length:18px_18px] bg-no-repeat bg-[right_10px_center]"
                        style={{ background: "var(--bg-input)", borderColor: "var(--border-subtle)", color: "var(--text-primary)" }}
                    >
                        <option value="">— Not present —</option>
                        {headers.map(h => (
                            <option key={h} value={h}>{h}</option>
                        ))}
                    </select>
                    {mapping[field.key] && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    )}
                </div>
            ))}
        </div>
    );
}

function PreviewTable<T extends Record<string, unknown>>({
    title, icon, rows, fields, summary,
}: {
    title: string; icon: React.ReactNode;
    rows: T[]; fields: FieldDef[];
    summary: { open: number; totalOpen: number; missingDates: number; total: number };
}) {
    const preview = rows.slice(0, 20);
    const fieldKeys = fields.map(f => f.key);

    return (
        <div className="space-y-3">
            <SectionHeader icon={icon} title={title} />
            {/* Summary bar */}
            <div className="flex gap-4 rounded-xl px-4 py-3 text-[11px] border shadow-sm" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                <span className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> <span className="font-bold text-slate-900">{summary.open}</span> open items</span>
                <span className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>Total Exposure: <span className="text-slate-900 font-bold">{fmt(summary.totalOpen)}</span></span>
                {summary.missingDates > 0 && (
                    <span className="text-rose-600 font-bold flex items-center gap-1.5 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-100"><AlertTriangle className="w-3.5 h-3.5" /> {summary.missingDates} rows missing dates</span>
                )}
            </div>
            {/* Table */}
            <div className="overflow-auto rounded-lg border max-h-64 custom-scrollbar" style={{ borderColor: "var(--border-default)" }}>
                <table className="w-full text-xs">
                    <thead className="sticky top-0 shadow-sm" style={{ background: "var(--bg-surface)" }}>
                        <tr className="border-b" style={{ borderColor: "var(--border-subtle)" }}>
                            {fields.map(f => (
                                <th key={f.key} className="px-3 py-2 text-left font-medium whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                                    {f.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                        {preview.map((row, i) => (
                            <tr key={i} className="hover:bg-gray-50 transition-colors">
                                {fieldKeys.map(k => (
                                    <td key={k} className="px-3 py-1.5 whitespace-nowrap max-w-32 truncate" style={{ color: "var(--text-secondary)" }}>
                                        {row[k] != null && row[k] !== "" ? String(row[k]) : <span style={{ color: "var(--text-muted)" }}>—</span>}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {rows.length > 20 && (
                <p className="text-xs text-gray-600 text-center italic">Showing first 20 of {rows.length} rows</p>
            )}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ARAPUploadStep({ companyId, onDone }: Props) {
    const [phase, setPhase] = useState<Phase>("upload");
    const [ar, setAr] = useState<FileState>(emptyFile());
    const [ap, setAp] = useState<FileState>(emptyFile());
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [result, setResult] = useState<ImportResult>({});

    // Load saved mappings on mount
    useEffect(() => {
        if (!companyId) return;
        const load = async (kind: "ar" | "ap") => {
            const res = await fetch(`/api/upload/mapping?companyId=${companyId}&kind=${kind}`);
            if (!res.ok) return;
            const data = await res.json();
            if (data.found && Object.keys(data.mappingJson).length > 0) {
                const setter = kind === "ar" ? setAr : setAp;
                setter(s => ({ ...s, mapping: data.mappingJson, savedMappingLoaded: true }));
            }
        };
        load("ar");
        load("ap");
    }, [companyId]);

    // ── File handlers ────────────────────────────────────────────────────────

    const handleFiles = async (kind: "ar" | "ap", files: File[]) => {
        const setter = kind === "ar" ? setAr : setAp;
        const state = kind === "ar" ? ar : ap;
        const fields = kind === "ar" ? AR_FIELDS : AP_FIELDS;

        setter(s => ({ ...s, loading: true, error: null }));
        try {
            const parsedResults = await Promise.all(files.map(parseFile));

            const allHeaders = new Set<string>();
            const allRows: Record<string, string>[] = [];
            const fileNames: string[] = [];
            let totalRows = 0;

            for (const p of parsedResults) {
                p.headers.forEach(h => allHeaders.add(h));
                allRows.push(...p.rows);
                fileNames.push(p.fileName);
                totalRows += p.rowCount;
            }

            const mergedParsed: ParsedFile = {
                headers: Array.from(allHeaders),
                rows: allRows,
                rowCount: totalRows,
                fileName: fileNames.length > 1 ? `${fileNames.length} files (${fileNames[0]}...)` : fileNames[0]
            };

            const detected = autoDetect(mergedParsed.headers, fields);
            const mapping = Object.keys(state.mapping).length > 0 ? state.mapping : detected;
            setter(s => ({ ...s, parsed: mergedParsed, mapping, loading: false }));
        } catch (e: unknown) {
            setter(s => ({ ...s, loading: false, error: (e as Error).message }));
        }
    };

    // ── Mapping handlers ─────────────────────────────────────────────────────

    const setArMapping = (key: string, value: string) =>
        setAr(s => ({ ...s, mapping: { ...s.mapping, [key]: value } }));
    const setApMapping = (key: string, value: string) =>
        setAp(s => ({ ...s, mapping: { ...s.mapping, [key]: value } }));

    function rerunAutoDetect() {
        if (ar.parsed) {
            const detected = autoDetect(ar.parsed.headers, AR_FIELDS);
            setAr(s => ({ ...s, mapping: detected }));
        }
        if (ap.parsed) {
            const detected = autoDetect(ap.parsed.headers, AP_FIELDS);
            setAp(s => ({ ...s, mapping: detected }));
        }
    }

    // ── Validation ───────────────────────────────────────────────────────────

    function mappingErrors(): string[] {
        const errs: string[] = [];
        if (ar.parsed) {
            for (const f of AR_FIELDS.filter(f => f.required)) {
                if (!ar.mapping[f.key]) errs.push(`AR: "${f.label}" is required`);
            }
        }
        if (ap.parsed) {
            for (const f of AP_FIELDS.filter(f => f.required)) {
                if (!ap.mapping[f.key]) errs.push(`AP: "${f.label}" is required`);
            }
        }
        return errs;
    }

    // ── Normalized data ──────────────────────────────────────────────────────

    const arRows: NormalizedARRow[] = ar.parsed
        ? applyARMapping(ar.parsed.rows, ar.mapping)
        : [];
    const apRows: NormalizedAPRow[] = ap.parsed
        ? applyAPMapping(ap.parsed.rows, ap.mapping)
        : [];

    const arSum = arSummary(arRows);
    const apSum = apSummary(apRows);

    // ── Import ───────────────────────────────────────────────────────────────

    async function handleImport() {
        setSubmitting(true);
        setSubmitError(null);
        const res: ImportResult = {};

        try {
            if (arRows.length > 0) {
                const r = await fetch("/api/upload/ar", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ companyId, rows: arRows, mappingJson: ar.mapping }),
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error ?? "AR import failed");
                res.ar = { imported: d.imported, updated: d.updated, deleted: d.deleted, total: d.total };
            }

            if (apRows.length > 0) {
                const r = await fetch("/api/upload/ap", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ companyId, rows: apRows, mappingJson: ap.mapping }),
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error ?? "AP import failed");
                res.ap = { imported: d.imported, updated: d.updated, deleted: d.deleted, total: d.total };
            }

            setResult(res);
            setPhase("done");
        } catch (e: unknown) {
            setSubmitError((e as Error).message);
        } finally {
            setSubmitting(false);
        }
    }

    const hasUploaded = ar.parsed || ap.parsed;
    const errors = phase === "mapping" ? mappingErrors() : [];

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-5">

            {/* ── Phase: Upload ── */}
            {phase === "upload" && (
                <>
                    <div>
                        <h3 className="text-base font-bold mb-1 flex items-center gap-2" style={{ color: "var(--text-primary)" }}><FolderOpen className="w-5 h-5" /> Upload AR/AP Files</h3>
                        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Upload your Accounts Receivable and/or Accounts Payable export. Supports CSV, XLSX, and PDF.</p>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        <Dropzone
                            label="Accounts Receivable (AR)"
                            icon={<Inbox className="w-5 h-5" />}
                            file={ar.parsed}
                            onFiles={fs => handleFiles("ar", fs)}
                            error={ar.error}
                            loading={ar.loading}
                        />
                        <Dropzone
                            label="Accounts Payable (AP)"
                            icon={<Upload className="w-5 h-5" />}
                            file={ap.parsed}
                            onFiles={fs => handleFiles("ap", fs)}
                            error={ap.error}
                            loading={ap.loading}
                        />
                    </div>

                    {/* Saved mapping hint */}
                    {(ar.savedMappingLoaded || ap.savedMappingLoaded) && (
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700">
                             <CheckCircle2 className="w-4 h-4" /> Saved column mapping found — will be applied automatically
                        </div>
                    )}

                    <div className="flex gap-3 pt-1">
                        <button
                            onClick={onDone}
                            className="px-4 py-2.5 rounded-xl text-sm transition-colors border"
                            style={{ background: "var(--bg-raised)", color: "var(--text-secondary)", borderColor: "var(--border-default)" }}
                        >
                            Skip for now
                        </button>
                        <button
                            disabled={!hasUploaded || ar.loading || ap.loading}
                            onClick={() => setPhase("mapping")}
                            className="flex-1 py-2.5 text-white font-semibold rounded-xl transition-all disabled:opacity-40 text-sm shadow-lg shadow-emerald-100"
                            style={{ background: "var(--color-positive)" }}
                        >
                            Review Column Mapping <ArrowRight className="w-4 h-4 ml-1 inline-block" />
                        </button>
                    </div>
                </>
            )}

            {/* ── Phase: Mapping ── */}
            {phase === "mapping" && (
                <>
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className="text-base font-bold mb-1 flex items-center gap-2" style={{ color: "var(--text-primary)" }}><FileSpreadsheet className="w-5 h-5" /> Map Columns</h3>
                            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Match your file headers to the required fields. Fields marked <span className="text-red-500">*</span> are required.</p>
                        </div>
                        <button
                            onClick={rerunAutoDetect}
                            className="text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium shadow-sm"
                            style={{ color: "var(--color-positive)", background: "var(--bg-surface)", borderColor: "var(--border-default)" }}
                        >
                            <Search className="w-3.5 h-3.5 mr-1.5 inline-block" /> Auto-detect
                        </button>
                    </div>

                    {ar.parsed && (
                        <MappingPanel
                            title="AR — Accounts Receivable"
                            icon={<Inbox className="w-5 h-5" />}
                            fields={AR_FIELDS}
                            headers={ar.parsed.headers}
                            mapping={ar.mapping}
                            onChange={setArMapping}
                        />
                    )}

                    {ap.parsed && (
                        <MappingPanel
                            title="AP — Accounts Payable"
                            icon={<Upload className="w-5 h-5" />}
                            fields={AP_FIELDS}
                            headers={ap.parsed.headers}
                            mapping={ap.mapping}
                            onChange={setApMapping}
                        />
                    )}

                    {errors.length > 0 && (
                        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-1">
                            {errors.map((e, i) => <p key={i} className="text-xs text-red-700">• {e}</p>)}
                        </div>
                    )}

                    <div className="flex gap-3 pt-1">
                        <button onClick={() => setPhase("upload")} className="px-4 py-2.5 rounded-xl text-sm transition-colors border" style={{ background: "var(--bg-raised)", color: "var(--text-secondary)", borderColor: "var(--border-default)" }}><ArrowLeft className="w-4 h-4 mr-1 inline-block" /> Back</button>
                        <button
                            disabled={errors.length > 0}
                            onClick={() => setPhase("preview")}
                            className="flex-1 py-2.5 text-white font-semibold rounded-xl transition-all disabled:opacity-40 text-sm shadow-lg shadow-emerald-100"
                            style={{ background: "var(--color-positive)" }}
                        >
                            Preview Import <ArrowRight className="w-4 h-4 ml-1 inline-block" />
                        </button>
                    </div>
                </>
            )}

            {/* ── Phase: Preview ── */}
            {phase === "preview" && (
                <>
                    <div>
                        <h3 className="text-base font-bold mb-1 flex items-center gap-2" style={{ color: "var(--text-primary)" }}><Search className="w-5 h-5" /> Preview & Confirm</h3>
                        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Review the first 10 rows before importing. Use &quot;Edit Mapping&quot; to adjust columns.</p>
                    </div>

                    {arRows.length > 0 && (
                        <PreviewTable
                            title="Accounts Receivable"
                            icon={<Inbox className="w-5 h-5" />}
                            rows={arRows as unknown as Record<string, unknown>[]}
                            fields={AR_FIELDS}
                            summary={arSum}
                        />
                    )}

                    {apRows.length > 0 && (
                        <PreviewTable
                            title="Accounts Payable"
                            icon={<Upload className="w-5 h-5" />}
                            rows={apRows as unknown as Record<string, unknown>[]}
                            fields={AP_FIELDS}
                            summary={apSum}
                        />
                    )}

                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4" /> No valid rows after mapping. Check your column assignments.
                        </div>

                    {submitError && (
                        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                            {submitError}
                        </div>
                    )}

                    <div className="flex gap-3 pt-1">
                        <button onClick={() => setPhase("mapping")} className="px-4 py-2.5 rounded-xl text-sm transition-colors border shadow-sm" style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", borderColor: "var(--border-default)" }}>
                            <Pencil className="w-3.5 h-3.5 mr-1.5 inline-block" /> Edit Mapping
                        </button>
                        <button
                            disabled={submitting || (arRows.length === 0 && apRows.length === 0)}
                            onClick={handleImport}
                            className="flex-1 py-2.5 text-white font-semibold rounded-xl transition-all disabled:opacity-40 text-sm shadow-lg shadow-emerald-100"
                            style={{ background: "var(--color-positive)" }}
                        >
                            {submitting ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Importing…
                                </span>
                            ) : <>Confirm & Import {(arRows.length + apRows.length).toLocaleString()} rows <ArrowRight className="w-4 h-4 ml-1 inline-block" /></>}
                        </button>
                    </div>
                </>
            )}

            {/* ── Phase: Done ── */}
            {phase === "done" && (
                <>
                    <div className="text-center space-y-3 py-4">
                        <div className="flex justify-center mb-2"><CheckCircle className="w-12 h-12 text-emerald-500" /></div>
                        <h3 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Import Complete</h3>
                        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Your AR/AP data is now in the forecast.</p>
                    </div>

                    <div className="space-y-3">
                        <div className="flex justify-between items-center rounded-lg px-4 py-3 border" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                            <span className="text-sm flex items-center gap-2" style={{ color: "var(--text-secondary)" }}><Inbox className="w-4 h-4" /> AR Invoices</span>
                            <div className="text-right">
                                <span className="text-sm font-medium block" style={{ color: "var(--color-positive)" }}>
                                    {result.ar ? `${result.ar.imported} new · ${result.ar.updated} updated` : "No data uploaded"}
                                </span>
                                {result.ar && result.ar.deleted > 0 && (
                                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                                        {result.ar.deleted} old records removed
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex justify-between items-center rounded-lg px-4 py-3 border" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                            <span className="text-sm flex items-center gap-2" style={{ color: "var(--text-secondary)" }}><Upload className="w-4 h-4" /> AP Bills</span>
                            <div className="text-right">
                                <span className="text-sm font-medium block" style={{ color: "var(--color-positive)" }}>
                                    {result.ap ? `${result.ap.imported} new · ${result.ap.updated} updated` : "No data uploaded"}
                                </span>
                                {result.ap && result.ap.deleted > 0 && (
                                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                                        {result.ap.deleted} old records removed
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={onDone}
                        className="w-full py-3 text-white font-semibold rounded-xl transition-all text-sm shadow-lg shadow-emerald-100"
                        style={{ background: "var(--color-positive)" }}
                    >
                        Go to Dashboard <ArrowRight className="w-4 h-4 ml-1 inline-block" />
                    </button>
                </>
            )}
        </div>
    );
}
