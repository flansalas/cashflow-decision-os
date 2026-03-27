// ui/BankUploadStep.tsx – 3-phase Upload → Mapping → Preview → Done → Detect → Review Patterns
// Integrates with /api/upload/bank, /api/upload/bank/detect, /api/upload/bank/patterns
"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Users, Building2, Landmark, Package, Zap, Fuel, Wrench, ClipboardList, CreditCard, Pin, FolderOpen, FileSpreadsheet, Search, CheckCircle, CheckCircle2, ChevronUp, ChevronDown, Pencil, AlertTriangle, Circle, ArrowRight, ArrowLeft, ArrowUp, ArrowDown } from "lucide-react";
import { parseFile, ParsedFile } from "@/services/parseFile";
import {
    BANK_FIELDS, FieldDef,
    autoDetect,
    applyBankMapping,
    NormalizedBankRow,
    bankSummary,
} from "@/services/columnMapper";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
    companyId: string;
    onDone: () => void; // called after import or skip
}

type Phase = "upload" | "mapping" | "preview" | "done" | "detecting" | "review";

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
    bank?: { imported: number; updated: number; deleted: number; total: number };
}

interface DetectedPattern {
    merchantKey: string;
    displayName: string;
    cadence: string;
    typicalAmount: number;
    amountStdDev: number;
    confidence: "high" | "med" | "low";
    occurrences: number;
    firstSeen: string;
    lastSeen: string;
    nextExpectedDate: string;
    category: string;
}

interface ReviewPattern extends DetectedPattern {
    included: boolean;
    editedName: string;
    editedAmount: string;
    editedDate: string;
    isCritical: boolean;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">{icon}</span>
            <div>
                <h4 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h4>
                {sub && <p className="text-xs" style={{ color: "var(--text-muted)" }}>{sub}</p>}
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
    summary: { inflows: number; outflows: number; total: number };
}) {
    const preview = rows.slice(0, 20);
    const fieldKeys = fields.map(f => f.key);

    return (
        <div className="space-y-3">
            <SectionHeader icon={icon} title={title} />
            {/* Summary bar */}
            <div className="flex gap-4 rounded-xl px-4 py-3 text-[11px] border shadow-sm" style={{ background: "var(--bg-raised)", borderColor: "var(--border-subtle)" }}>
                <span className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}><ArrowDown className="w-3.5 h-3.5 text-emerald-600" /> <span className="font-bold text-slate-900">{summary.inflows}</span> inflows</span>
                <span className="flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}><ArrowUp className="w-3.5 h-3.5 text-rose-600" /> <span className="font-bold text-slate-900">{summary.outflows}</span> outflows</span>
                <span className="ml-auto" style={{ color: "var(--text-muted)" }}>{summary.total} total rows</span>
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

const confidenceBadge: Record<string, string> = {
    high: "bg-emerald-50 text-emerald-700 border-emerald-200",
    med: "bg-amber-50 text-amber-700 border-amber-200",
    low: "bg-red-50 text-red-700 border-red-200",
};

const categoryIcons: Record<string, React.ReactNode> = {
    payroll: <Users className="w-5 h-5" />, rent: <Building2 className="w-5 h-5" />, loan: <Landmark className="w-5 h-5" />, subscription: <Package className="w-5 h-5" />,
    utilities: <Zap className="w-5 h-5" />, fuel: <Fuel className="w-5 h-5" />, materials: <Wrench className="w-5 h-5" />, taxes: <ClipboardList className="w-5 h-5" />,
    card_payment: <CreditCard className="w-5 h-5" />, other: <Pin className="w-5 h-5" />,
};

function PatternCard({
    pattern,
    onChange,
}: {
    pattern: ReviewPattern;
    onChange: (p: ReviewPattern) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className={`rounded-xl border transition-all duration-300 ${pattern.included
            ? "border-slate-300 bg-white ring-1 ring-slate-900/5 shadow-md scale-[1.01]"
            : "border-slate-100 bg-slate-50/50 opacity-40 grayscale scale-[0.98]"
            }`}
        >
            {/* Main row */}
            <div className="flex items-center gap-3 px-4 py-3">
                {/* Include checkbox */}
                <button
                    onClick={() => onChange({ ...pattern, included: !pattern.included })}
                    className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 border transition-all duration-200 active:scale-90 ${pattern.included
                        ? "bg-slate-900 border-slate-900 text-white shadow-md shadow-slate-900/20"
                        : "border-slate-200 bg-slate-50 text-transparent"
                        }`}
                >
                    <CheckCircle2 className={`w-4 h-4 ${pattern.included ? "opacity-100" : "opacity-0"}`} />
                </button>

                {/* Icon */}
                <span className="text-base shrink-0">{categoryIcons[pattern.category] || <Pin className="w-4 h-4" />}</span>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{pattern.editedName}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full border ${confidenceBadge[pattern.confidence]}`}>
                            {pattern.confidence}
                        </span>
                        <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>{pattern.cadence}</span>
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                        Seen {pattern.occurrences}× · Next: {new Date(pattern.editedDate).toLocaleDateString()}
                    </div>
                </div>

                {/* Amount */}
                <div className="text-right shrink-0">
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>${Math.round(pattern.typicalAmount).toLocaleString()}</p>
                    {pattern.amountStdDev > 0 && (
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>±${Math.round(pattern.amountStdDev).toLocaleString()}</p>
                    )}
                </div>

                {/* Expand */}
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="text-gray-400 hover:text-emerald-600 text-xs px-1 shrink-0 transition-colors"
                    title="Edit details"
                >
                    {expanded ? <ChevronUp className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                </button>
            </div>

            {/* Expanded edit form */}
            {expanded && (
                <div className="px-4 pb-4 pt-1 space-y-3 border-t" style={{ borderColor: "var(--border-subtle)" }}>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs uppercase block mb-1 font-semibold" style={{ color: "var(--text-muted)" }}>Display Name</label>
                            <input
                                type="text"
                                value={pattern.editedName}
                                onChange={e => onChange({ ...pattern, editedName: e.target.value })}
                                className="w-full border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                            />
                        </div>
                        <div>
                            <label className="text-xs uppercase block mb-1 font-semibold" style={{ color: "var(--text-muted)" }}>Amount ($)</label>
                            <input
                                type="number"
                                value={pattern.editedAmount}
                                onChange={e => onChange({ ...pattern, editedAmount: e.target.value })}
                                min={0}
                                className="w-full border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
                                style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs uppercase block mb-1 font-semibold" style={{ color: "var(--text-muted)" }}>Next Expected Date</label>
                        <input
                            type="date"
                            value={pattern.editedDate.slice(0, 10)}
                            onChange={e => onChange({ ...pattern, editedDate: e.target.value })}
                            className="w-full border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
                            style={{ background: "var(--bg-input)", borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                        />
                    </div>
                    <button
                        onClick={() => onChange({ ...pattern, isCritical: !pattern.isCritical })}
                        className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full transition-colors font-medium ${pattern.isCritical
                            ? "bg-red-50 text-red-700 border-red-200 border"
                            : "text-gray-500 hover:text-gray-700 border border-gray-200"
                            }`}
                        style={!pattern.isCritical ? { background: "var(--bg-raised)" } : {}}
                    >
                        {pattern.isCritical ? <><AlertTriangle className="w-3.5 h-3.5 mr-1" /> Critical — click to unmark</> : <><Circle className="w-3.5 h-3.5 mr-1" /> Mark as critical</>}
                    </button>
                </div>
            )}
        </div>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function BankUploadStep({ companyId, onDone }: Props) {
    const [phase, setPhase] = useState<Phase>("upload");
    const [bankFile, setBankFile] = useState<FileState>(emptyFile());
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [result, setResult] = useState<ImportResult>({});

    // Pattern detection state
    const [reviewPatterns, setReviewPatterns] = useState<ReviewPattern[]>([]);
    const [patternSaving, setPatternSaving] = useState(false);
    const [patternError, setPatternError] = useState<string | null>(null);
    const [patternSavedCount, setPatternSavedCount] = useState(0);

    // Load saved mappings on mount
    useEffect(() => {
        if (!companyId) return;
        const load = async () => {
            const res = await fetch(`/api/upload/mapping?companyId=${companyId}&kind=bank`);
            if (!res.ok) return;
            const data = await res.json();
            if (data.found && Object.keys(data.mappingJson).length > 0) {
                setBankFile(s => ({ ...s, mapping: data.mappingJson, savedMappingLoaded: true }));
            }
        };
        load();
    }, [companyId]);

    // ── File handlers ────────────────────────────────────────────────────────

    const handleFiles = async (files: File[]) => {
        setBankFile(s => ({ ...s, loading: true, error: null }));
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

            const detected = autoDetect(mergedParsed.headers, BANK_FIELDS);
            const mapping = Object.keys(bankFile.mapping).length > 0 ? bankFile.mapping : detected;
            setBankFile(s => ({ ...s, parsed: mergedParsed, mapping, loading: false }));
        } catch (e: unknown) {
            setBankFile(s => ({ ...s, loading: false, error: (e as Error).message }));
        }
    };

    // ── Mapping handlers ─────────────────────────────────────────────────────

    const setMapping = (key: string, value: string) =>
        setBankFile(s => ({ ...s, mapping: { ...s.mapping, [key]: value } }));

    function rerunAutoDetect() {
        if (bankFile.parsed) {
            const detected = autoDetect(bankFile.parsed.headers, BANK_FIELDS);
            setBankFile(s => ({ ...s, mapping: detected }));
        }
    }

    // ── Validation ───────────────────────────────────────────────────────────

    function mappingErrors(): string[] {
        const errs: string[] = [];
        if (bankFile.parsed) {
            for (const f of BANK_FIELDS.filter(f => f.required)) {
                if (!bankFile.mapping[f.key]) errs.push(`Bank: "${f.label}" is required`);
            }
        }
        return errs;
    }

    // ── Normalized data ──────────────────────────────────────────────────────

    const bankRows: NormalizedBankRow[] = bankFile.parsed
        ? applyBankMapping(bankFile.parsed.rows, bankFile.mapping)
        : [];

    const bankSum = bankSummary(bankRows);

    // ── Import + then auto-detect ────────────────────────────────────────────

    async function handleImport() {
        setSubmitting(true);
        setSubmitError(null);
        const res: ImportResult = {};

        try {
            if (bankRows.length > 0) {
                const r = await fetch("/api/upload/bank", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ companyId, rows: bankRows, mappingJson: bankFile.mapping }),
                });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error ?? "Bank import failed");
                res.bank = { imported: d.imported, updated: d.updated, deleted: d.deleted, total: d.total };
            }

            setResult(res);
            setPhase("done");
        } catch (e: unknown) {
            setSubmitError((e as Error).message);
        } finally {
            setSubmitting(false);
        }
    }

    // ── Run pattern detection after import ────────────────────────────────────

    async function runDetection() {
        setPhase("detecting");
        try {
            const r = await fetch("/api/upload/bank/detect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error ?? "Detection failed");

            const suggestions: DetectedPattern[] = d.suggestions ?? [];

            if (suggestions.length === 0) {
                // Nothing found — go straight to finish
                onDone();
                return;
            }

            // Convert to ReviewPattern with editable fields
            setReviewPatterns(suggestions.map(p => ({
                ...p,
                included: p.confidence !== "low",   // pre-check high/med confidence items
                editedName: p.displayName,
                editedAmount: String(Math.round(p.typicalAmount)),
                editedDate: p.nextExpectedDate,
                isCritical: false,
            })));

            setPhase("review");
        } catch {
            // If detection fails, silently skip it and move on
            onDone();
        }
    }

    // ── Save approved patterns ────────────────────────────────────────────────

    async function handleSavePatterns() {
        setPatternSaving(true);
        setPatternError(null);

        const approved = reviewPatterns
            .filter(p => p.included)
            .map(p => ({
                merchantKey: p.merchantKey,
                displayName: p.editedName.trim() || p.displayName,
                cadence: p.cadence,
                typicalAmount: parseFloat(p.editedAmount) || p.typicalAmount,
                amountStdDev: p.amountStdDev,
                confidence: p.confidence,
                nextExpectedDate: p.editedDate || p.nextExpectedDate,
                category: p.category,
                isCritical: p.isCritical,
            }));

        if (approved.length === 0) {
            onDone();
            return;
        }

        try {
            const r = await fetch("/api/upload/bank/patterns", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ companyId, patterns: approved }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error ?? "Save failed");
            setPatternSavedCount(d.saved ?? approved.length);
            onDone();
        } catch (e: unknown) {
            setPatternError((e as Error).message);
        } finally {
            setPatternSaving(false);
        }
    }

    const hasUploaded = !!bankFile.parsed;
    const errors = phase === "mapping" ? mappingErrors() : [];
    const includedCount = reviewPatterns.filter(p => p.included).length;

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <div className="space-y-5">

            {/* ── Phase: Upload ── */}
            {phase === "upload" && (
                <>
                    <div>
                        <h3 className="text-base font-bold mb-1 flex items-center gap-2" style={{ color: "var(--text-primary)" }}><FolderOpen className="w-5 h-5" /> Upload Bank Statement</h3>
                        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Upload your bank statement. Supports CSV, XLSX, and PDF.</p>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        <Dropzone
                            label="Bank Statement"
                            icon={<Landmark className="w-5 h-5" />}
                            file={bankFile.parsed}
                            onFiles={handleFiles}
                            error={bankFile.error}
                            loading={bankFile.loading}
                        />
                    </div>

                    {/* Saved mapping hint */}
                    {bankFile.savedMappingLoaded && (
                        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700">
                             <CheckCircle2 className="w-4 h-4" /> Saved column mapping found — will be applied automatically
                        </div>
                    )}

                    <div className="flex gap-3 pt-1">
                        <button
                            onClick={onDone}
                            className="px-4 py-2.5 rounded-xl text-sm transition-colors border shadow-sm"
                            style={{ background: "var(--bg-raised)", color: "var(--text-secondary)", borderColor: "var(--border-default)" }}
                        >
                            Skip for now
                        </button>
                        <button
                            disabled={!hasUploaded || bankFile.loading}
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

                    {bankFile.parsed && (
                        <MappingPanel
                            title="Bank Statement"
                            icon={<Landmark className="w-5 h-5" />}
                            fields={BANK_FIELDS}
                            headers={bankFile.parsed.headers}
                            mapping={bankFile.mapping}
                            onChange={setMapping}
                        />
                    )}

                    {errors.length > 0 && (
                        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 space-y-1">
                            {errors.map((e, i) => <p key={i} className="text-xs text-red-700">• {e}</p>)}
                        </div>
                    )}

                    <div className="flex gap-3 pt-1">
                        <button onClick={() => setPhase("upload")} className="px-4 py-2.5 rounded-xl text-sm transition-colors border shadow-sm" style={{ background: "var(--bg-raised)", color: "var(--text-secondary)", borderColor: "var(--border-default)" }}><ArrowLeft className="w-4 h-4 mr-1 inline-block" /> Back</button>
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
                        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Review the first 20 rows before importing. Use &quot;Edit Mapping&quot; to adjust columns.</p>
                    </div>

                    {bankRows.length > 0 && (
                        <PreviewTable
                            title="Bank Statement"
                            icon={<Landmark className="w-5 h-5" />}
                            rows={bankRows as unknown as Record<string, unknown>[]}
                            fields={BANK_FIELDS}
                            summary={bankSum}
                        />
                    )}

                    {bankRows.length === 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700">
                            <AlertTriangle className="w-4 h-4" /> No valid rows after mapping. Check your column assignments.
                        </div>
                    )}

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
                            disabled={submitting || bankRows.length === 0}
                            onClick={handleImport}
                            className="flex-1 py-2.5 text-white font-semibold rounded-xl transition-all disabled:opacity-40 text-sm shadow-lg shadow-emerald-100"
                            style={{ background: "var(--color-positive)" }}
                        >
                            {submitting ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Importing…
                                </span>
                            ) : <>Confirm & Import {(bankRows.length).toLocaleString()} rows <ArrowRight className="w-4 h-4 ml-1 inline-block" /></>}
                        </button>
                    </div>
                </>
            )}

            {/* ── Phase: Done (import success, prompt for detection) ── */}
            {phase === "done" && (
                <>
                    <div className="text-center space-y-3 py-2">
                        <div className="flex justify-center mb-2"><CheckCircle className="w-12 h-12 text-emerald-500" /></div>
                        <h3 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>Import Complete</h3>
                        {result.bank && (
                            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                                {result.bank.imported.toLocaleString()} transactions imported successfully.
                            </p>
                        )}
                    </div>

                    {/* Detection prompt */}
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
                        <div className="flex items-start gap-3">
                            <Search className="w-6 h-6 shrink-0 mt-1 text-blue-500" />
                            <div>
                                <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Detect Recurring Commitments</p>
                                <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                                    We can scan your transactions for recurring patterns — loans, subscriptions, insurance, utilities — and add them to your Commitments panel automatically. You&apos;ll review each suggestion before anything is saved.
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={runDetection}
                            className="w-full py-2.5 text-white text-sm font-semibold rounded-xl transition-all shadow-md shadow-blue-100"
                            style={{ background: "var(--color-primary)" }}
                        >
                            <Search className="w-4 h-4 inline-block mr-2" /> Scan for Recurring Commitments <ArrowRight className="w-4 h-4 ml-1 inline-block" />
                        </button>
                    </div>

                    <button
                        onClick={onDone}
                        className="w-full py-2.5 rounded-xl text-sm transition-colors border"
                        style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", borderColor: "var(--border-default)" }}
                    >
                        Skip & Go to Dashboard
                    </button>
                </>
            )}

            {/* ── Phase: Detecting (spinner) ── */}
            {phase === "detecting" && (
                <div className="py-12 text-center space-y-4">
                    <div className="flex items-center justify-center">
                        <div className="w-12 h-12 border-4 border-gray-100 border-t-blue-500 rounded-full animate-spin" />
                    </div>
                    <div>
                        <p className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Scanning transactions…</p>
                        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>Looking for recurring merchants and payment patterns</p>
                    </div>
                </div>
            )}

            {/* ── Phase: Review detected patterns ── */}
            {phase === "review" && (
                <>
                    <div>
                        <h3 className="text-base font-bold mb-1 flex items-center gap-2" style={{ color: "var(--text-primary)" }}><ClipboardList className="w-5 h-5" /> Detected Recurring Commitments</h3>
                        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                            We found {reviewPatterns.length} recurring patterns in your transactions. Check the ones to add to your Commitments panel — you can edit each one before saving.
                        </p>
                    </div>

                    {/* Quick select all / none */}
                    <div className="flex gap-3">
                        <button
                            onClick={() => setReviewPatterns(ps => ps.map(p => ({ ...p, included: true })))}
                            className="text-xs px-3 py-1.5 rounded-lg transition-colors font-medium border shadow-sm"
                            style={{ background: "var(--bg-surface)", color: "var(--color-positive)", borderColor: "var(--border-default)" }}
                        >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 inline-block" /> Select all
                        </button>
                        <button
                            onClick={() => setReviewPatterns(ps => ps.map(p => ({ ...p, included: false })))}
                            className="text-xs px-3 py-1.5 rounded-lg transition-colors font-medium border shadow-sm"
                            style={{ background: "var(--bg-surface)", color: "var(--text-secondary)", borderColor: "var(--border-default)" }}
                        >
                            ○ Deselect all
                        </button>
                        <span className="ml-auto text-xs flex items-center" style={{ color: "var(--text-muted)" }}>
                            {includedCount} of {reviewPatterns.length} selected
                        </span>
                    </div>

                    {/* Pattern cards */}
                    <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar pr-1">
                        {reviewPatterns.map((p, i) => (
                            <PatternCard
                                key={p.merchantKey}
                                pattern={p}
                                onChange={updated =>
                                    setReviewPatterns(ps => ps.map((x, idx) => idx === i ? updated : x))
                                }
                            />
                        ))}
                    </div>

                    {patternError && (
                        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                            {patternError}
                        </div>
                    )}

                    <div className="flex gap-3 pt-1">
                        <button
                            onClick={onDone}
                            className="px-4 py-2.5 rounded-xl text-sm transition-colors border shadow-sm"
                            style={{ background: "var(--bg-raised)", color: "var(--text-secondary)", borderColor: "var(--border-default)" }}
                        >
                            Skip
                        </button>
                        <button
                            onClick={handleSavePatterns}
                            disabled={patternSaving || includedCount === 0}
                            className="flex-1 py-2.5 text-white font-semibold rounded-xl transition-all disabled:opacity-40 text-sm shadow-lg shadow-emerald-100"
                            style={{ background: "var(--color-positive)" }}
                        >
                            {patternSaving ? (
                                <span className="flex items-center justify-center gap-2">
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Saving…
                                </span>
                            ) : includedCount === 0
                                ? "None selected — skip"
                                : <><CheckCircle2 className="w-4 h-4 mr-1.5" /> Add {includedCount} commitment{includedCount !== 1 ? "s" : ""} to Forecast <ArrowRight className="w-4 h-4 ml-1 inline-block" /></>
                            }
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
