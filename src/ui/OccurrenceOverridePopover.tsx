"use client";

import { useState } from "react";
import { X, Save, Trash2, Loader2, AlertCircle } from "lucide-react";
import { Commitment } from "./PlannedEventsGrid";

interface OccurrenceOverridePopoverProps {
    companyId: string;
    commitment: Commitment;
    weekStart: string;
    originalAmount: number;
    rect: DOMRect;
    onClose: () => void;
    onSaved: () => void;
}

export function OccurrenceOverridePopover({
    companyId,
    commitment,
    weekStart,
    originalAmount,
    rect,
    onClose,
    onSaved
}: OccurrenceOverridePopoverProps) {
    const [amount, setAmount] = useState(originalAmount.toString());
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Position the popover below or above the cell based on available space
    const topSpace = rect.top;
    const bottomSpace = window.innerHeight - rect.bottom;
    const popoverHeight = 180; // approximate height
    
    let top = rect.bottom + 8;
    let left = rect.left + (rect.width / 2) - 150; // center it horizontally (width 300)
    
    if (bottomSpace < popoverHeight && topSpace > popoverHeight) {
        top = rect.top - popoverHeight - 8;
    }
    
    // clamp left
    if (left < 10) left = 10;
    if (left + 300 > window.innerWidth) left = window.innerWidth - 310;

    const handleSave = async () => {
        const numAmount = parseFloat(amount.replace(/[^0-9.-]+/g, ""));
        if (isNaN(numAmount) || numAmount < 0) {
            setError("Please enter a valid amount.");
            return;
        }

        setIsSaving(true);
        setError(null);
        try {
            const res = await fetch("/api/overrides", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    tenantId: companyId,
                    type: "modify_recurring_occurrence",
                    targetType: "recurring_pattern",
                    targetId: commitment.id,
                    amount: numAmount,
                    effectiveDate: weekStart, // ISO string weekStart
                    metaJson: JSON.stringify({
                        displayName: commitment.displayName
                    }),
                    reason: "Manual occurrence override"
                })
            });
            if (!res.ok) throw new Error("Failed to save override");
            onSaved();
            onClose();
        } catch (err: any) {
            setError(err.message);
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100]" onClick={onClose}>
            <div 
                className="absolute bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden w-[300px]"
                style={{ top, left }}
                onClick={(e) => e.stopPropagation()} // prevent closing when clicking inside
            >
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <div>
                        <h4 className="font-bold text-sm text-slate-900">{commitment.displayName}</h4>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mt-0.5">
                            Modify Occurrence
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                
                <div className="p-4">
                    {error && (
                        <div className="mb-3 flex items-start gap-2 text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100">
                            <AlertCircle className="w-4 h-4 shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}
                    
                    <div className="mb-4">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
                            Original Amount
                        </label>
                        <div className="text-sm font-financial text-slate-500 line-through">
                            ${originalAmount.toLocaleString()}
                        </div>
                    </div>
                    
                    <div className="mb-5">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-700 mb-1.5">
                            New Amount
                        </label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-medium">$</span>
                            <input 
                                type="text"
                                autoFocus
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                className="w-full pl-7 pr-3 py-2 border rounded-lg text-sm font-financial focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                            />
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2 px-3 rounded-lg text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                        >
                            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Save Amount
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
