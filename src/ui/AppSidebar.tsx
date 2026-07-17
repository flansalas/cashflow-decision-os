"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { UserButton, OrganizationSwitcher, useOrganizationList, useOrganization } from "@clerk/nextjs";
import {
    Box, BarChart3, ListFilter, Repeat2, Layers, Settings2,
    ChevronLeft, ChevronRight, PanelLeftClose, PanelLeft, Database, History, CheckCircle2,
    ArrowDownToLine, ArrowUpFromLine, GitBranch
} from "lucide-react";

interface NavItem {
    icon: React.ReactNode;
    label: string;
    href?: string;
    onClick?: () => void;
    section: "plan" | "manage" | "tools" | "control";
}

const STORAGE_KEY = "cfdo_sidebar_collapsed";

export function AppSidebar() {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(true);
    const [isDemo, setIsDemo] = useState(false);

    // Clerk Org Auto-Selection
    const { organization } = useOrganization();
    const { isLoaded, setActive, userMemberships } = useOrganizationList({
        userMemberships: { infinite: true },
    });

    useEffect(() => {
        if (!isLoaded || !setActive) return;
        if (organization) return; // already have an active org

        const memberships = userMemberships.data ?? [];
        if (memberships.length === 0) return;

        if (memberships.length === 1) {
            // Single-org user: always auto-select their only org
            setActive({ organization: memberships[0].organization.id });
        } else {
            // Multi-org user: restore last explicitly chosen org, or do nothing
            // (let the user pick via the OrganizationSwitcher)
            const lastOrgId = localStorage.getItem("cfdo_last_org_id");
            const isValidLastOrg = lastOrgId && memberships.some(m => m.organization.id === lastOrgId);
            if (isValidLastOrg) {
                setActive({ organization: lastOrgId! });
            }
            // If no valid last selection, do NOT auto-pick — show the switcher
        }
    }, [isLoaded, organization, userMemberships.data, setActive]);

    // Persist the active org whenever it changes, and evict any stale legacy companyId
    useEffect(() => {
        if (organization?.id) {
            localStorage.setItem("cfdo_last_org_id", organization.id);
            localStorage.removeItem("cfdo_company_id"); // prevent cross-tenant bleed
        }
    }, [organization?.id]);

    // Hydrate sidebar-collapsed state and legacy isDemo flag from localStorage.
    // companyName is NOT read from localStorage — it comes from Clerk organization.name below.
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved !== null) setCollapsed(saved === "true");

            const demo = localStorage.getItem("cfdo_is_demo");
            if (demo === "true") setIsDemo(true);
        } catch { /* noop */ }
    }, []);

    // Active company name: always comes from Clerk's active organization.
    // Falls back to null (shows nothing) — never shows a stale previous org name.
    const companyName = organization?.name ?? null;

    const toggle = () => {
        const next = !collapsed;
        setCollapsed(next);
        try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* noop */ }
    };

    const handleOpenSetup = () => {
        if (pathname === "/plan") {
            window.dispatchEvent(new CustomEvent('open-setup'));
        } else {
            window.location.href = '/plan?setup=true';
        }
    };

    const handleOpenData = () => {
        if (pathname === "/sources" || pathname.startsWith("/sources")) {
            window.dispatchEvent(new CustomEvent('open-data-sources'));
        } else {
            window.location.href = '/sources';
        }
    };

    const navItems: NavItem[] = [
        {
            icon: <BarChart3 className="w-[18px] h-[18px]" />,
            label: "Plan",
            href: "/plan",
            section: "plan",
        },
        {
            icon: <CheckCircle2 className="w-[18px] h-[18px]" />,
            label: "Weekly Review",
            href: "/review",
            section: "plan",
        },
        {
            icon: <ArrowDownToLine className="w-[18px] h-[18px]" />,
            label: "Receivables",
            href: "/receivables",
            section: "manage",
        },
        {
            icon: <ArrowUpFromLine className="w-[18px] h-[18px]" />,
            label: "Payables",
            href: "/payables",
            section: "manage",
        },
        {
            icon: <Repeat2 className="w-[18px] h-[18px]" />,
            label: "Cash Commitments",
            href: "/planned",
            section: "tools",
        },
        {
            icon: <GitBranch className="w-[18px] h-[18px]" />,
            label: "Scenarios",
            href: "/scenarios",
            section: "tools",
        },
        {
            icon: <Database className="w-[18px] h-[18px]" />,
            label: "Data Sources",
            href: "/sources",
            section: "tools",
        },
    ];

    // Admin items
    // (Moved Data Sources to Tools)

    // Only show setup for non-demo
    if (!isDemo) {
        navItems.push({
            icon: <Settings2 className="w-[18px] h-[18px]" />,
            label: "Settings",
            href: "/settings",
            section: "control",
        });
    }

    navItems.push({
        icon: <History className="w-[18px] h-[18px]" />,
        label: "Audit Log",
        href: "/audit",
        section: "control",
    });

    const planItems = navItems.filter(i => i.section === "plan");
    const manageItems = navItems.filter(i => i.section === "manage");
    const toolsItems = navItems.filter(i => i.section === "tools");
    const controlItems = navItems.filter(i => i.section === "control");

    const isActive = (href?: string) => {
        if (!href) return false;
        if (href === "/plan") return pathname === "/plan";
        return pathname.startsWith(href);
    };

    const renderItem = (item: NavItem, idx: number) => {
        const active = isActive(item.href);

        // When collapsed: the whole sidebar expands on click — nav items must
        // stop propagation so they don't also navigate / fire their own handler.
        const Component = item.href ? "a" : "button";
        const props = item.href ? { href: item.href } : { onClick: item.onClick, type: "button" as const };

        if (collapsed) {
            return (
                <Component
                    key={idx}
                    {...(props as any)}
                    title={item.label}
                    onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        if (item.onClick) item.onClick();
                    }}
                    className={`
                        sidebar-nav-item group relative flex items-center justify-center rounded-xl transition-all duration-200 cursor-pointer
                        w-10 h-10 mx-auto
                        ${active
                            ? "bg-indigo-50 text-indigo-700"
                            : "text-slate-400 hover:text-slate-800 hover:bg-slate-50"
                        }
                    `}
                >
                    {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-indigo-600" />
                    )}
                    <span className="shrink-0 transition-transform duration-200 group-hover:scale-110">{item.icon}</span>
                </Component>
            );
        }

        // Expanded: normal interactive item
        return (
            <Component
                key={idx}
                {...(props as any)}
                className={`
                    sidebar-nav-item group relative flex items-center gap-3 rounded-xl transition-all duration-200 cursor-pointer
                    px-3 py-2.5 w-full
                    ${active
                        ? "bg-indigo-50 text-indigo-700 font-bold shadow-sm"
                        : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                    }
                `}
            >
                {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 rounded-r-full bg-indigo-600" />
                )}
                <span className={`shrink-0 transition-transform duration-200 ${active ? "scale-110" : "group-hover:scale-105"}`}>
                    {item.icon}
                </span>
                <span className="text-[13px] font-semibold tracking-tight truncate whitespace-nowrap">
                    {item.label}
                </span>
            </Component>
        );
    };

    return (
        <aside
            className="sidebar-root fixed left-0 top-0 h-screen z-[60] flex flex-col border-r bg-white/95 backdrop-blur-md"
            style={{
                width: collapsed ? "64px" : "220px",
                transition: "width 250ms cubic-bezier(0.4, 0, 0.2, 1)",
                borderColor: "var(--border-subtle)",
                cursor: collapsed ? "pointer" : "default",
            }}
            onClick={collapsed ? toggle : undefined}
            title={collapsed ? "Expand sidebar" : undefined}
        >
            {/* Sidebar Header (QBO Style) */}
            <div className={`flex items-center shrink-0 h-14 ${collapsed ? "justify-center border-b" : "justify-between px-4 border-b"}`} style={{ borderColor: "var(--border-subtle)" }}>
                
                {/* Logo and Name */}
                {!collapsed && (
                    <div className="flex items-center gap-2 overflow-hidden flex-1">
                        <Box className="w-5 h-5 text-indigo-600 shrink-0" />
                        <div className="flex flex-col min-w-0">
                            <span className="text-[10px] font-black tracking-[0.2em] text-slate-900 leading-none truncate">CF/D·OS</span>
                            {companyName && (
                                <span className="text-[10px] text-slate-400 font-medium truncate leading-tight mt-0.5">{companyName}</span>
                            )}
                        </div>
                    </div>
                )}

                {/* Toggle Button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        toggle();
                    }}
                    className={`
                        flex items-center justify-center shrink-0
                        rounded-md transition-all duration-200 hover:bg-slate-100
                        w-8 h-8 text-slate-400 hover:text-indigo-600
                    `}
                    title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    <div className="w-full h-full flex items-center justify-center">
                        {collapsed ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="translate-x-[0.5px]">
                                <polyline points="9 18 15 12 9 6" />
                            </svg>
                        ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="-translate-x-[0.5px]">
                                <polyline points="15 18 9 12 15 6" />
                            </svg>
                        )}
                    </div>
                </button>
            </div>

            <nav className="flex-1 flex flex-col px-2 pt-4 gap-1 overflow-y-auto">
                {!collapsed && (
                    <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300 px-3 mb-2">Plan</span>
                )}
                {planItems.map(renderItem)}

                {!collapsed && (
                    <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300 px-3 mb-2 mt-4">Manage Cash</span>
                )}
                {manageItems.map((item, idx) => renderItem(item, idx + planItems.length))}

                {!collapsed && (
                    <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300 px-3 mb-2 mt-4">Tools</span>
                )}
                {toolsItems.map((item, idx) => renderItem(item, idx + planItems.length + manageItems.length))}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Control section */}
                {controlItems.length > 0 && (
                    <>
                        {!collapsed && (
                            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300 px-3 mb-2 mt-4">Control</span>
                        )}
                        {controlItems.map((item, idx) => renderItem(item, idx + planItems.length + manageItems.length + toolsItems.length))}
                    </>
                )}
            </nav>

            {/* User & Org Switcher (Clerk) */}
            <div className={`p-3 border-t shrink-0 flex flex-col gap-3 transition-opacity duration-200 ${collapsed ? "items-center" : "items-start"}`} style={{ borderColor: "var(--border-subtle)" }}>
                <div className={`flex items-center gap-3 w-full ${collapsed ? "justify-center" : "justify-between"}`}>
                    <UserButton appearance={{ elements: { avatarBox: "w-8 h-8" } }} />
                    {!collapsed && <OrganizationSwitcher appearance={{ elements: { rootBox: "flex-1" } }} hidePersonal />}
                </div>
            </div>

        </aside>
    );
}
