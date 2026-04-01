"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, FileText, Repeat, Briefcase, CornerDownRight, X } from "lucide-react";

interface SearchResult {
    id: string;
    type: string;
    label: string;
    amount: number;
    color: string;
    url: string;
    dateInfo: string;
}

function fmt(n: number) {
    if (!n) return "$0";
    return "$" + Math.round(n).toLocaleString("en-US");
}

export function GlobalSearch({ open, onClose }: { open: boolean, onClose: () => void }) {
    const router = useRouter();
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

    // Auto-focus input when opened
    useEffect(() => {
        if (open) {
            setQuery("");
            setResults([]);
            setTimeout(() => inputRef.current?.focus(), 10);
        }
    }, [open]);

    // Handle search input with debounce
    useEffect(() => {
        if (!query || query.length < 2) {
            setResults([]);
            setLoading(false);
            setActiveIndex(0);
            return;
        }

        setLoading(true);
        if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

        debounceTimeout.current = setTimeout(() => {
            fetch(`/api/search?q=${encodeURIComponent(query)}`)
                .then(r => r.json())
                .then(data => {
                    setResults(data.results || []);
                    setActiveIndex(0);
                })
                .catch(() => setResults([]))
                .finally(() => setLoading(false));
        }, 300);

        return () => {
            if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
        };
    }, [query]);

    // Keyboard navigation
    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
            } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((prev) => (prev > 0 ? prev - 1 : prev));
            } else if (e.key === "Enter" && results.length > 0) {
                e.preventDefault();
                handleSelect(results[activeIndex]);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open, results, activeIndex, onClose]);

    const handleSelect = (r: SearchResult) => {
        onClose();
        router.push(r.url);
    };

    if (!open) return null;

    // Grouping results
    const groups: Record<string, SearchResult[]> = {};
    results.forEach(r => {
        const cat = r.type.includes("AR") ? "Receivables" : r.type.includes("AP") ? "Payables" : r.type.includes("Recurring") ? "Recurring" : "Other";
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(r);
    });

    return (
        <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4" 
             style={{ background: "rgba(15, 23, 42, 0.4)", backdropFilter: "blur(6px)" }}
             onClick={onClose}>
            
            <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border overflow-hidden flex flex-col" 
                 style={{ borderColor: "var(--border-default)" }}
                 onClick={e => e.stopPropagation()}>
                
                {/* Search Input */}
                <div className="flex items-center px-4 py-3 text-slate-800 border-b relative" style={{ borderColor: "var(--border-subtle)" }}>
                    <Search className="w-5 h-5 text-slate-400 mr-3 shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="Search entities, amounts (e.g. 5000), invoices..."
                        className="flex-1 bg-transparent border-none outline-none text-base placeholder:text-slate-400 py-1"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                    {query && (
                        <button onClick={() => setQuery("")} className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors">
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {/* Results Area */}
                <div className="max-h-[60vh] overflow-y-auto w-full bg-slate-50 relative pb-2 min-h-[50px]">
                    {loading && (
                        <div className="absolute inset-x-0 top-0 h-0.5 bg-blue-100 overflow-hidden">
                            <div className="h-full bg-blue-500 w-1/3 animate-[slide_1s_ease-in-out_infinite]" />
                        </div>
                    )}
                    
                    {!loading && query && results.length === 0 && (
                        <div className="px-5 py-10 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
                            <Search className="w-8 h-8 text-slate-300 mx-auto" strokeWidth={1.5} />
                            <p className="text-sm font-medium">No results found for "{query}"</p>
                            <p className="text-xs text-slate-400">Try searching for a vendor name, amount, or invoice number.</p>
                        </div>
                    )}

                    {!query && (
                        <div className="px-5 py-4 text-xs font-medium uppercase tracking-widest text-slate-400 mt-2">
                            Suggested Highlights ({new Date().getFullYear()})
                        </div>
                    )}

                    {results.length > 0 && (
                        <div className="py-2">
                            {Object.entries(groups).map(([catName, items]) => (
                                <div key={catName}>
                                    <div className="px-5 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400 sticky top-0 bg-slate-50/95 backdrop-blur-sm z-10 border-y border-transparent">
                                        {catName}
                                    </div>
                                    <ul className="px-2 space-y-0.5">
                                        {items.map((r) => {
                                            const index = results.findIndex(res => res.id === r.id);
                                            const isActive = index === activeIndex;
                                            return (
                                                <li key={r.id}>
                                                    <button
                                                        onClick={() => handleSelect(r)}
                                                        onMouseEnter={() => setActiveIndex(index)}
                                                        className={`w-full text-left flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors group ${
                                                            isActive ? "bg-white shadow-sm ring-1 ring-slate-200" : "hover:bg-slate-100/50"
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                                            <div className={`w-8 h-8 rounded shrink-0 flex items-center justify-center border
                                                                ${r.type.includes('AR') ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 
                                                                  r.type.includes('AP') ? 'bg-rose-50 text-rose-600 border-rose-100' : 
                                                                  'bg-indigo-50 text-indigo-600 border-indigo-100'}`}>
                                                                {r.type.includes('Receive') || r.type.includes('AR') ? <CornerDownRight className="w-4 h-4" /> : 
                                                                 r.type.includes('Recur') ? <Repeat className="w-4 h-4" /> : 
                                                                 <Briefcase className="w-4 h-4" />}
                                                            </div>
                                                            <div className="min-w-0 pr-4">
                                                                <div className="flex items-center gap-2">
                                                                    <p className="text-sm font-semibold text-slate-900 truncate">{r.label}</p>
                                                                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                                                                        {r.type}
                                                                    </span>
                                                                </div>
                                                                <p className="text-xs text-slate-400 mt-0.5 truncate">{r.dateInfo}</p>
                                                            </div>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                            <span className={`text-sm font-bold font-financial tracking-tight
                                                                ${r.type.includes('AR') ? 'text-emerald-700' : 
                                                                  r.type.includes('AP') ? 'text-rose-600' : 
                                                                  'text-slate-700'}`}>
                                                                {r.type.includes('AR') ? '+' : r.type.includes('AP') ? '−' : ''}{fmt(r.amount)}
                                                            </span>
                                                        </div>
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                
                {/* Footer hints */}
                <div className="px-4 py-2 bg-slate-100 border-t flex justify-between items-center" style={{ borderColor: 'var(--border-subtle)' }}>
                    <div className="flex items-center gap-4 text-[10px] font-medium text-slate-500">
                        <span className="flex items-center gap-1"><kbd className="px-1.5 rounded border border-slate-300 bg-white font-sans">↑</kbd> <kbd className="px-1.5 rounded border border-slate-300 bg-white font-sans">↓</kbd> to navigate</span>
                        <span className="flex items-center gap-1"><kbd className="px-1.5 rounded border border-slate-300 bg-white font-sans text-[9px]">ENTER</kbd> to select</span>
                    </div>
                </div>
            </div>

            <style dangerouslySetInnerHTML={{ __html: `
                @keyframes slide {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(300%); }
                }
            `}} />
        </div>
    );
}
