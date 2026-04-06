"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import {
    Box, BarChart3, ListFilter, Repeat2, Layers, Settings2,
    ChevronLeft, ChevronRight, PanelLeftClose, PanelLeft, Database, History
} from "lucide-react";

interface NavItem {
    icon: React.ReactNode;
    label: string;
    href?: string;
    onClick?: () => void;
    section: "workspace" | "admin";
}

const STORAGE_KEY = "cfdo_sidebar_collapsed";

export function AppSidebar() {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(true);
    const [companyName, setCompanyName] = useState<string | null>(null);
    const [isDemo, setIsDemo] = useState(false);

    // Hydrate from localStorage
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved !== null) setCollapsed(saved === "true");
            
            const name = localStorage.getItem("cfdo_company_name");
            if (name) setCompanyName(name);
            
            const demo = localStorage.getItem("cfdo_is_demo");
            if (demo === "true") setIsDemo(true);
        } catch { /* noop */ }
        
        // Listen for storage changes across tabs or from our own app
        const handleStorage = () => {
            try {
                const name = localStorage.getItem("cfdo_company_name");
                if (name) setCompanyName(name);
                
                const demo = localStorage.getItem("cfdo_is_demo");
                setIsDemo(demo === "true");
            } catch { /* noop */ }
        };
        const interval = setInterval(handleStorage, 1000);
        return () => clearInterval(interval);
    }, []);

    const toggle = () => {
        const next = !collapsed;
        setCollapsed(next);
        try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* noop */ }
    };

    const handleOpenSetup = () => {
        if (pathname === "/dashboard") {
            window.dispatchEvent(new CustomEvent('open-setup'));
        } else {
            window.location.href = '/dashboard?setup=true';
        }
    };

    const handleOpenData = () => {
        if (pathname === "/cashflow" || pathname.startsWith("/cashflow")) {
            window.dispatchEvent(new CustomEvent('open-data-sources'));
        } else {
            window.location.href = '/cashflow?open=data';
        }
    };

    const navItems: NavItem[] = [
        {
            icon: <BarChart3 className="w-[18px] h-[18px]" />,
            label: "Dashboard",
            href: "/dashboard",
            section: "workspace",
        },
        {
            icon: <ListFilter className="w-[18px] h-[18px]" />,
            label: "AR / AP Ledger",
            href: "/cashflow",
            section: "workspace",
        },
        {
            icon: <Repeat2 className="w-[18px] h-[18px]" />,
            label: "Commitments",
            href: "/recurring",
            section: "workspace",
        },
        {
            icon: <Layers className="w-[18px] h-[18px]" />,
            label: "Cash Adjustments",
            href: "/cash-adjustments",
            section: "workspace",
        },
    ];

    // Admin items
    navItems.push({
        icon: <Database className="w-[18px] h-[18px]" />,
        label: "Data Sources",
        onClick: handleOpenData,
        section: "admin",
    });

    // Only show setup for non-demo
    if (!isDemo) {
        navItems.push({
            icon: <Settings2 className="w-[18px] h-[18px]" />,
            label: "Setup",
            onClick: handleOpenSetup,
            section: "admin",
        });
    }

    navItems.push({
        icon: <History className="w-[18px] h-[18px]" />,
        label: "Audit Log",
        href: "/audit",
        section: "admin",
    });

    const workspaceItems = navItems.filter(i => i.section === "workspace");
    const adminItems = navItems.filter(i => i.section === "admin");

    const isActive = (href?: string) => {
        if (!href) return false;
        if (href === "/dashboard") return pathname === "/dashboard";
        return pathname.startsWith(href);
    };

    const renderItem = (item: NavItem, idx: number) => {
        const active = isActive(item.href);

        // When collapsed: the whole sidebar expands on click — nav items must
        // stop propagation so they don't also navigate / fire their own handler.
        if (collapsed) {
            return (
                <div
                    key={idx}
                    title={item.label}
                    className={`
                        sidebar-nav-item group relative flex items-center justify-center rounded-xl transition-all duration-200
                        w-10 h-10 mx-auto
                        ${active
                            ? "bg-indigo-50 text-indigo-700"
                            : "text-slate-400"
                        }
                    `}
                >
                    {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-indigo-600" />
                    )}
                    <span className="shrink-0">{item.icon}</span>
                </div>
            );
        }

        // Expanded: normal interactive item
        const Component = item.href ? "a" : "button";
        const props = item.href ? { href: item.href } : { onClick: item.onClick, type: "button" as const };

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
            <div className={`flex items-center shrink-0 h-14 relative ${collapsed ? "justify-center border-b" : "px-4 border-b"}`} style={{ borderColor: "var(--border-subtle)" }}>
                
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

                {/* Toggle Button Tab */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        toggle();
                    }}
                    className={`
                        absolute top-1/2 -mt-3 -right-3 z-10
                        flex items-center justify-center 
                        border border-slate-200 bg-white rounded-full
                        transition-all duration-200 hover:scale-110 shadow-sm
                        w-6 h-6 text-slate-400 hover:text-indigo-600 hover:border-indigo-300 hover:shadow-md
                    `}
                    title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    {collapsed ? (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="4" y1="7" x2="18" y2="7" />
                            <line x1="4" y1="12" x2="11" y2="12" />
                            <line x1="4" y1="17" x2="18" y2="17" />
                            <polygon points="14,10 17,12 14,14" fill="currentColor" stroke="none" />
                        </svg>
                    ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="4" y1="7" x2="18" y2="7" />
                            <line x1="4" y1="12" x2="11" y2="12" />
                            <line x1="4" y1="17" x2="18" y2="17" />
                            <polygon points="17,10 14,12 17,14" fill="currentColor" stroke="none" />
                        </svg>
                    )}
                </button>
            </div>

            {/* Workspace nav */}
            <nav className="flex-1 flex flex-col px-2 pt-4 gap-1 overflow-y-auto">
                {!collapsed && (
                    <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300 px-3 mb-2">Workspace</span>
                )}
                {workspaceItems.map(renderItem)}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Admin section */}
                {adminItems.length > 0 && (
                    <>
                        {!collapsed && (
                            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-300 px-3 mb-2 mt-4">Admin</span>
                        )}
                        {adminItems.map((item, idx) => renderItem(item, idx + workspaceItems.length))}
                    </>
                )}
            </nav>


        </aside>
    );
}
