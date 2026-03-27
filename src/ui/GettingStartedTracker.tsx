// ui/GettingStartedTracker.tsx – QuickBooks-style achievement progress card
// Appears after Express Onboarding to guide users toward a fully "dialed in" forecast.
"use client";

import { useState, useEffect } from "react";
import {
    CheckCircle2, Circle, ChevronDown, ChevronUp,
    Landmark, Users, ClipboardList, FolderOpen, Shield,
    Sparkles, X, ArrowRight
} from "lucide-react";
import { useSpotlight } from "./SpotlightContext";

interface Props {
    companyId: string;
    hasBalance: boolean;
    hasPayroll: boolean;
    hasCommitments: boolean;
    hasARAPData: boolean;
    hasBuffer: boolean;
    /** Callback to open the setup wizard (for buffer/setup) */
    onOpenSetup: () => void;
    /** Callback to open the Cash Belt in Manage tab */
    onOpenCommitments: () => void;
    /** Callback to open the AR/AP upload */
    onOpenUpload?: () => void;
}

interface TaskItem {
    id: string;
    label: string;
    description: string;
    icon: React.ReactNode;
    done: boolean;
    action?: {
        label: string;
        onClick: () => void;
    };
}

export function GettingStartedTracker({
    companyId,
    hasBalance,
    hasPayroll,
    hasCommitments,
    hasARAPData,
    hasBuffer,
    onOpenSetup,
    onOpenCommitments,
    onOpenUpload,
}: Props) {
    const spotlight = useSpotlight();
    const storageKey = `cfdo_guide_dismissed_${companyId}`;
    const [dismissed, setDismissed] = useState(false);
    const [collapsed, setCollapsed] = useState(false);

    useEffect(() => {
        const val = localStorage.getItem(storageKey);
        if (val === "dismissed") {
            setDismissed(true);
            setCollapsed(true);
        }
    }, [storageKey]);

    const tasks: TaskItem[] = [
        {
            id: "balance",
            label: "Set opening balance",
            description: "Your bank balance is the foundation of the forecast.",
            icon: <Landmark className="w-4 h-4" />,
            done: hasBalance,
        },
        {
            id: "payroll",
            label: "Configure payroll",
            description: "Your biggest recurring outflow is now tracked.",
            icon: <Users className="w-4 h-4" />,
            done: hasPayroll,
        },
        {
            id: "commitments",
            label: "Add your rent & bills",
            description: "Recurring commitments make the forecast realistic.",
            icon: <ClipboardList className="w-4 h-4" />,
            done: hasCommitments,
            action: {
                label: "Add commitment",
                onClick: () => {
                    onOpenCommitments();
                    // Small delay to allow scroll/tab switch to settle before spotlighting
                    setTimeout(() => {
                        spotlight.focus("spotlight-add-event", "This is your Cash Belt. Let's register a recurring expense like Rent or Payroll.");
                    }, 100);
                },
            },
        },
        {
            id: "arap",
            label: "Upload invoices & bills",
            description: "Real AR/AP data gives exact inflow & outflow dates.",
            icon: <FolderOpen className="w-4 h-4" />,
            done: hasARAPData,
            action: onOpenUpload ? {
                label: "Upload",
                onClick: onOpenUpload,
            } : undefined,
        },
        {
            id: "buffer",
            label: "Set your safety buffer",
            description: "The 'red line' that tells you when to worry.",
            icon: <Shield className="w-4 h-4" />,
            done: hasBuffer,
            action: {
                label: "Set buffer",
                onClick: onOpenSetup,
            },
        },
    ];

    const doneCount = tasks.filter(t => t.done).length;
    const totalCount = tasks.length;
    const percentDone = Math.round((doneCount / totalCount) * 100);
    const allDone = doneCount === totalCount;

    // If all tasks are done, auto-dismiss after first render
    useEffect(() => {
        if (allDone && !dismissed) {
            // Give the user a moment to see the completed state
            const t = setTimeout(() => {
                setDismissed(true);
                setCollapsed(true);
                localStorage.setItem(storageKey, "dismissed");
            }, 3000);
            return () => clearTimeout(t);
        }
    }, [allDone, dismissed, storageKey]);

    const handleDismiss = () => {
        setDismissed(true);
        setCollapsed(true);
        localStorage.setItem(storageKey, "dismissed");
    };

    const handleReopen = () => {
        setDismissed(false);
        setCollapsed(false);
        localStorage.removeItem(storageKey);
    };

    // Collapsed mini-bar
    if (dismissed && collapsed) {
        // Don't show anything if all done
        if (allDone) return null;
        return (
            <div
                onClick={handleReopen}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === "Enter" || e.key === " " ? handleReopen() : undefined}
                className="w-full text-left rounded-xl px-4 py-2.5 border flex items-center gap-2 transition-colors hover:brightness-105 cursor-pointer"
                style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}
            >
                <Sparkles className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                    Your forecast is {percentDone}% dialed in
                </span>
                <span className="text-xs ml-auto font-semibold" style={{ color: "var(--color-primary)" }}>
                    Show guide <ArrowRight className="w-3 h-3 inline-block ml-0.5" />
                </span>
            </div>
        );
    }

    return (
        <div className="rounded-xl border overflow-hidden shadow-sm" style={{ background: "var(--bg-surface)", borderColor: "var(--border-subtle)" }}>
            {/* Header */}
            <div className="px-5 py-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-blue-400" />
                    <div>
                        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                            {allDone ? "Forecast fully dialed in!" : "Get the most from your forecast"}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                            {doneCount} of {totalCount} steps complete
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setCollapsed(!collapsed)}
                        className="w-6 h-6 flex items-center justify-center rounded-lg transition-colors"
                        style={{ color: "var(--text-muted)" }}
                    >
                        {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="w-6 h-6 flex items-center justify-center rounded-lg transition-colors hover:text-red-400"
                        style={{ color: "var(--text-faint)" }}
                        title="Dismiss guide"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Progress bar */}
            <div className="mx-5 mb-3">
                <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-input)" }}>
                    <div
                        className="h-full rounded-full transition-all duration-700 ease-out"
                        style={{
                            width: `${percentDone}%`,
                            background: allDone
                                ? "linear-gradient(90deg, #059669, #10b981)"
                                : "linear-gradient(90deg, #4f46e5, #6366f1)",
                        }}
                    />
                </div>
                <p className="text-[11px] mt-1 font-semibold" style={{ color: allDone ? "#059669" : "var(--text-muted)" }}>
                    {percentDone}% accurate
                </p>
            </div>

            {/* Task list */}
            {!collapsed && (
                <div className="px-5 pb-4 space-y-1">
                    {tasks.map(task => (
                        <div
                            key={task.id}
                            className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition-all ${task.done ? "opacity-60" : ""}`}
                            style={{ background: task.done ? "transparent" : "var(--bg-raised)" }}
                        >
                            {task.done ? (
                                <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                            ) : (
                                <Circle className="w-5 h-5 shrink-0" style={{ color: "var(--border-default)" }} />
                            )}
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium ${task.done ? "line-through" : ""}`} style={{ color: "var(--text-primary)" }}>
                                    {task.label}
                                </p>
                                <p className="text-xs" style={{ color: "var(--text-muted)" }}>{task.description}</p>
                            </div>
                            {!task.done && task.action && (
                                <button
                                    onClick={task.action.onClick}
                                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all hover:brightness-110 flex items-center gap-1"
                                    style={{ color: "var(--color-primary)", borderColor: "rgba(79,70,229,0.25)", background: "rgba(79,70,229,0.05)" }}
                                >
                                    {task.action.label} <ArrowRight className="w-3 h-3" />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
