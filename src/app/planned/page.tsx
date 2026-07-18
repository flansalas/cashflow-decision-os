// app/planned/page.tsx — Planned Events dedicated screen
"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
    ArrowLeft, Box, Plus, Pencil, Trash2, Check, Circle, X,
    Calendar, Settings, ChevronDown, ChevronUp, ArrowRight,
    AlertTriangle, Users, Building2, Landmark, Package, Zap,
    Fuel, Wrench, ClipboardList, CreditCard, Pin, Clock,
    ArrowUpRight, ArrowDownLeft, CheckCircle2, RefreshCw,
    GripVertical, TrendingDown, TrendingUp, BarChart3,
    Bot, User, EyeOff
} from "lucide-react";
import { HelpBubble } from "@/ui/HelpBubble";
import { CashImpactTable } from "@/ui/CashImpactTable";
import { PlannedEventDrawer } from "@/ui/PlannedEventDrawer";
import { PlannedEventsGrid } from "@/ui/PlannedEventsGrid";
import { PlannedWeekPanel } from "@/ui/PlannedWeekPanel";
import { useAuth, useOrganization } from "@clerk/nextjs";

// ── Types ──────────────────────────────────────────────────────────────

interface Commitment {
    id: string;
    displayName: string;
    category: string;
    cadence: string;
    nextExpectedDate: string | null;
    typicalAmount: number;
    confidence: string;
    isIncluded: boolean;
    isCritical: boolean;
    direction: string;
    status?: string;
    origin?: string;
    isAdjustment?: boolean;
}

interface WeekBreakdownItem {
    label: string;
    amount: number;
    type: string;
    sourceType: string;
    sourceId?: string;
    confidence: string;
    section?: string;
}

interface ForecastWeek {
    weekNumber: number;
    weekStart: string;
    weekEnd: string;
    startCash: number;
    endCashExpected: number;
    inflowsExpected: number;
    outflowsExpected: number;
    breakdown: {
        outflows: WeekBreakdownItem[];
        inflows: WeekBreakdownItem[];
    };
}

interface DashboardData {
    company: { id: string; name: string };
    commitments: Commitment[];
    commitmentsCount: number;
    forecast: { weeks: ForecastWeek[] };
    assumptions: { bufferMin: number };
    backlog: {
        overdueAP: Array<{ id: string; vendorName: string; billNo: string; amountOpen: number; dueDate: string | null; daysPastDue: number | null; kind: "ap" }>;
        overdueAR: Array<{ id: string; customerName: string; invoiceNo: string; amountOpen: number; dueDate: string | null; daysPastDue: number | null; kind: "ar" }>;
        totalOverdueAP: number;
        totalOverdueAR: number;
    };
    cash?: {
        adjustments?: Array<{
            id: string; type: string; amount: number; note: string; date: string; status?: string; origin?: string; description?: string | null;
        }>;
    };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function fmt(n: number): string {
    return "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 0 });
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
}

const categoryIcons: Record<string, React.ReactNode> = {
    payroll: <Users className="w-5 h-5" />, rent: <Building2 className="w-5 h-5" />, loan: <Landmark className="w-5 h-5" />,
    subscription: <Package className="w-5 h-5" />, utilities: <Zap className="w-5 h-5" />, fuel: <Fuel className="w-5 h-5" />,
    materials: <Wrench className="w-5 h-5" />, taxes: <ClipboardList className="w-5 h-5" />,
    card_payment: <CreditCard className="w-5 h-5" />, other: <Pin className="w-5 h-5" />,
};

const CADENCES = ["weekly", "biweekly", "monthly", "irregular"];
const CATEGORIES = ["other", "rent", "loan", "subscription", "utilities", "fuel", "materials", "taxes", "card_payment", "asset_sale"];



// ── Main Page ───────────────────────────────────────────────────────────

function RecurringContent() {
    const searchParams = useSearchParams();
    const highlightWeek = searchParams.get("highlightWeek") ? Number(searchParams.get("highlightWeek")) : null;
    const highlightId = searchParams.get("highlightId");

    const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
    const { isLoaded: isOrgLoaded, organization } = useOrganization();

    // Only use legacy companyId for unauthenticated mode
    const legacyCompanyId = (!isSignedIn && (searchParams.get("companyId") ?? (typeof window !== "undefined" ? localStorage.getItem("cfdo_company_id") : null))) || null;

    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<"schedule" | "manage">("schedule");
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingItem, setEditingItem] = useState<any>(null);
    const [plannedPanelWeek, setPlannedPanelWeek] = useState<{ weekNumber: number; weekStart: string; weekEnd: string; items: any[] } | null>(null);
    const [dismissedHighlights, setDismissedHighlights] = useState<Set<string>>(new Set());

    const handleDismiss = useCallback((id: string) => {
        setDismissedHighlights(prev => {
            const next = new Set(prev);
            next.add(id);
            return next;
        });
    }, []);

    const fetchData = useCallback(() => {
        // Authenticated with active org: no companyId — backend uses Clerk orgId
        // Legacy/unauthenticated: pass legacyCompanyId
        const q = (isSignedIn && organization?.id) ? "" : (legacyCompanyId ? `?companyId=${legacyCompanyId}` : "");
        const url = `/api/dashboard${q}`;
        setLoading(true);
        fetch(url)
            .then(r => r.json())
            .then(d => {
                if (d.error) setError(d.error);
                else { setData(d); setError(null); }
            })
            .catch(() => setError("Failed to load"))
            .finally(() => setLoading(false));
    }, [isSignedIn, organization?.id, legacyCompanyId]);

    useEffect(() => {
        if (!isAuthLoaded || !isOrgLoaded) return;
        if (isSignedIn && !organization) return; // wait for org activation
        fetchData();
    }, [isAuthLoaded, isOrgLoaded, isSignedIn, organization?.id, fetchData]);


    // Auto-switch to Manage if highlighting a specific commitment pattern
    useEffect(() => {
        if (highlightId && data?.commitments.some(c => c.id === highlightId)) {
            setTab("manage");
        }
    }, [highlightId, data?.commitments]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="text-center space-y-4">
                    <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full mx-auto" />
                    <p className="text-sm tracking-wide" style={{ color: "var(--text-muted)" }}>Loading recurring cash…</p>
                </div>
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="border rounded-xl p-8 max-w-md text-center" style={{ background: '#fff5f5', borderColor: 'rgba(220,38,38,0.25)' }}>
                    <p style={{ color: '#dc2626' }} className="text-base font-medium mb-3 flex items-center justify-center gap-2">
                        <AlertTriangle className="w-5 h-5 flex-shrink-0" /> {error}
                    </p>
                    <a href="/dashboard" style={{ color: 'var(--color-primary)' }} className="hover:underline text-sm flex items-center justify-center gap-1">
                        <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
                    </a>
                </div>
            </div>
        );
    }
    const currentWeekStartTime = data?.forecast?.weeks?.[0]?.weekStart ? new Date(data.forecast.weeks[0].weekStart).getTime() : 0;

    const plannedEvents = [
        ...data.commitments.filter(c => {
            // Hide one-time commitments (cadence irregular/one-time) that are in the past
            if (c.cadence === "irregular" || c.cadence === "one-time") {
                if (!c.nextExpectedDate) return true; // Keep if no date
                return new Date(c.nextExpectedDate).getTime() >= currentWeekStartTime;
            }
            return true; // Keep all recurring
        }),
        ...(data.cash?.adjustments || [])
            .filter(a => new Date(a.date).getTime() >= currentWeekStartTime)
            .map(a => ({
                id: a.id,
                displayName: a.note || "Adjustment",
                category: a.type,
                cadence: "one-time",
                nextExpectedDate: a.date,
                typicalAmount: Math.abs(a.amount),
                direction: a.amount < 0 ? "outflow" : "inflow",
                confidence: "high",
                isIncluded: true,
                isCritical: false,
                description: a.description,
                status: a.status || "active",
                origin: a.origin || "user",
                isAdjustment: true
            } as Commitment))
    ].sort((a, b) => {
        if (!a.nextExpectedDate) return 1;
        if (!b.nextExpectedDate) return -1;
        return new Date(a.nextExpectedDate).getTime() - new Date(b.nextExpectedDate).getTime();
    });

    return (
        <div className="min-h-screen" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
            {/* Header */}
            <header className="border-b sticky top-0 z-50 backdrop-blur-md" style={{ background: "rgba(255,255,255,0.92)", borderColor: "var(--border-subtle)", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
                <div className="max-w-5xl mx-auto px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <a href="/dashboard" className="text-xs font-medium flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                            <ArrowLeft className="w-3 h-3" /> Dashboard
                        </a>
                        <span style={{ color: "var(--border-default)" }}>/</span>
                        <span style={{ color: "var(--color-primary)" }} className="font-bold text-sm flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> Cash Commitments</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                setShowAddForm(true);
                            }}
                            className="px-3 py-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider rounded-lg shadow-sm transition-all"
                            style={{ background: "var(--color-primary)", color: "white" }}
                        >
                            <Plus className="w-3.5 h-3.5" /> Add Cash Commitment
                        </button>
                        <button onClick={fetchData} className="p-1.5 rounded-lg border text-sm" title="Refresh" style={{ background: "var(--bg-raised)", borderColor: "var(--border-default)", color: "var(--text-muted)" }}>
                            <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-5 py-6 space-y-5">
                {/* Main Grid replacing Tab Switcher and Impact Table */}
                <PlannedEventsGrid 
                    commitments={plannedEvents}
                    weeks={data.forecast.weeks}
                    bufferMin={data.assumptions.bufferMin}
                    onEdit={(item) => {
                        setEditingItem(item);
                        setShowAddForm(true);
                    }}
                    onWeekClick={(weekNum) => {
                        const selectedWeekData = data.forecast.weeks[weekNum - 1];
                        if (selectedWeekData) {
                            const recurringItems = [
                                ...selectedWeekData.breakdown.inflows
                                    .filter(i => i.sourceType === "recurring" || i.sourceType === "manual" || i.section?.includes("Inflows"))
                                    .map(i => ({ ...i, direction: "inflow" as const })),
                                ...selectedWeekData.breakdown.outflows
                                    .filter(o => o.sourceType === "recurring" || o.sourceType === "manual" || o.sourceType === "assumption" || o.section?.includes("Recurring"))
                                    .map(o => ({ ...o, direction: "outflow" as const }))
                            ];
                            setPlannedPanelWeek({
                                weekNumber: weekNum,
                                weekStart: selectedWeekData.weekStart,
                                weekEnd: selectedWeekData.weekEnd,
                                items: recurringItems,
                            });
                        }
                    }}
                    onAdd={() => setShowAddForm(true)}
                />
            </main>
            
            <PlannedEventDrawer 
                isOpen={showAddForm}
                onClose={() => {
                    setShowAddForm(false);
                    setEditingItem(null);
                }}
                onSaved={() => {
                    setShowAddForm(false);
                    setEditingItem(null);
                    fetchData();
                    if (plannedPanelWeek) setPlannedPanelWeek(null);
                }}
                companyId={data?.company.id ?? ""}
                editingItem={editingItem}
            />

            {plannedPanelWeek && data && (
                <PlannedWeekPanel
                    isOpen={!!plannedPanelWeek}
                    weekNumber={plannedPanelWeek.weekNumber}
                    weekStart={plannedPanelWeek.weekStart}
                    weekEnd={plannedPanelWeek.weekEnd}
                    items={plannedPanelWeek.items}
                    allWeeks={data.forecast.weeks}
                    companyId={data.company.id}
                    onClose={() => setPlannedPanelWeek(null)}
                    onSaved={() => {
                        setPlannedPanelWeek(null);
                        fetchData();
                    }}
                    onEditPattern={(item) => {
                        const originalItem = plannedEvents.find(c => c.id === item.sourceId);
                        if (originalItem) {
                            setEditingItem(originalItem);
                        } else {
                            // If we can't find it in planned events for some reason, we pass the generic one
                            setEditingItem(item);
                        }
                        setShowAddForm(true);
                        setPlannedPanelWeek(null);
                    }}
                    hideManageAll={true}
                />
            )}
        </div>
    );
}

export default function RecurringPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-base)" }}>
                <div className="animate-spin w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full" />
            </div>
        }>
            <RecurringContent />
        </Suspense>
    );
}
