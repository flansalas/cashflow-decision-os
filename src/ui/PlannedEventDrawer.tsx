"use client";

import React, { useState, useEffect } from "react";
import { X, Calendar, Repeat, ArrowRight, ArrowLeft } from "lucide-react";

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
    companyId: string;
}

type EventType = "one-time" | "recurring";
type Direction = "inflow" | "outflow";

export function PlannedEventDrawer({ isOpen, onClose, onSaved, companyId }: Props) {
    const [type, setType] = useState<EventType>("one-time");
    const [direction, setDirection] = useState<Direction>("outflow");
    const [name, setName] = useState("");
    const [amount, setAmount] = useState("");
    const [category, setCategory] = useState("Uncategorized");
    const [date, setDate] = useState("");
    const [cadence, setCadence] = useState("monthly");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset state when opened
    useEffect(() => {
        if (isOpen) {
            setType("one-time");
            setDirection("outflow");
            setName("");
            setAmount("");
            setCategory("Uncategorized");
            setDate(new Date().toISOString().slice(0, 10));
            setCadence("monthly");
            setError(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSave = async () => {
        if (!name.trim() || !amount || !date) {
            setError("Please fill out all required fields.");
            return;
        }

        setSaving(true);
        setError(null);

        try {
            const res = await fetch("/api/planned-events", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    companyId,
                    type,
                    direction,
                    name: name.trim(),
                    amount: parseFloat(amount),
                    category,
                    date,
                    cadence: type === "recurring" ? cadence : "irregular",
                })
            });

            if (!res.ok) {
                const data = await res.json();
                setError(data.error || "Failed to save event");
                return;
            }

            onSaved();
            onClose();
        } catch (e) {
            setError("Network error occurred.");
        } finally {
            setSaving(false);
        }
    };

    // Natural Language Engine
    let nlText = "Fill out the details above.";
    if (name && amount && date) {
        const amtStr = `$${parseFloat(amount || "0").toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
        const dirStr = direction === "inflow" ? "inflow" : "outflow";
        const dateStr = new Date(date).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
        
        if (type === "one-time") {
            nlText = `This will add a ${amtStr} ${dirStr} on ${dateStr}.`;
        } else {
            nlText = `This will add a ${amtStr} ${dirStr} ${cadence} starting on ${dateStr}.`;
        }
    }

    return (
        <div className="fixed inset-0 z-[100] flex justify-end">
            {/* Backdrop */}
            <div 
                className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm transition-opacity" 
                onClick={onClose}
            />
            
            {/* Drawer */}
            <div className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300 border-l border-slate-200">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <h2 className="text-lg font-bold text-slate-800">Add Planned Event</h2>
                    <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Toggle */}
                    <div className="flex p-1 bg-slate-100 rounded-lg">
                        <button 
                            onClick={() => setType("one-time")}
                            className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-2 ${type === "one-time" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                        >
                            <Calendar className="w-4 h-4" /> One-Time
                        </button>
                        <button 
                            onClick={() => setType("recurring")}
                            className={`flex-1 py-2 text-sm font-semibold rounded-md transition-all flex items-center justify-center gap-2 ${type === "recurring" ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
                        >
                            <Repeat className="w-4 h-4" /> Repeating
                        </button>
                    </div>

                    <div className="space-y-4">
                        {/* Name */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Name / Description</label>
                            <input 
                                type="text" 
                                value={name} 
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g. Rent, Server Costs, Loan Payment"
                                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>

                        {/* Amount & Direction */}
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Amount</label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                                    <input 
                                        type="number" 
                                        min="0"
                                        step="0.01"
                                        value={amount} 
                                        onChange={e => setAmount(e.target.value)}
                                        placeholder="0.00"
                                        className="w-full border border-slate-300 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    />
                                </div>
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Type</label>
                                <select 
                                    value={direction}
                                    onChange={e => setDirection(e.target.value as Direction)}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                                >
                                    <option value="outflow">Money Out (Expense)</option>
                                    <option value="inflow">Money In (Income)</option>
                                </select>
                            </div>
                        </div>

                        {/* Date & Cadence */}
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">
                                    {type === "one-time" ? "Date" : "Starting Date"}
                                </label>
                                <input 
                                    type="date" 
                                    value={date} 
                                    onChange={e => setDate(e.target.value)}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                />
                            </div>
                            {type === "recurring" && (
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 tracking-wider">Repeats</label>
                                    <select 
                                        value={cadence}
                                        onChange={e => setCadence(e.target.value)}
                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                                    >
                                        <option value="weekly">Weekly</option>
                                        <option value="biweekly">Every 2 Weeks</option>
                                        <option value="monthly">Monthly</option>
                                        <option value="quarterly">Quarterly</option>
                                        <option value="annually">Annually</option>
                                    </select>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Natural Language Preview */}
                    <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 mt-6">
                        <p className="text-sm text-indigo-900 font-medium leading-relaxed">
                            {nlText}
                        </p>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg border border-red-100">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
                    <button 
                        onClick={onClose}
                        className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold shadow-md hover:bg-indigo-500 transition-colors disabled:opacity-50"
                    >
                        {saving ? "Saving..." : "Add to Forecast"}
                    </button>
                </div>
            </div>
        </div>
    );
}
