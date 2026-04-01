"use client";

import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { AppSidebar } from "./AppSidebar";

const STORAGE_KEY = "cfdo_sidebar_collapsed";

// Pages that should show the sidebar
const SIDEBAR_ROUTES = ["/dashboard", "/cashflow", "/recurring", "/cash-adjustments"];

export function ClientShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const [collapsed, setCollapsed] = useState(true);

    // Mirror the sidebar's collapsed state so we can offset content
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved !== null) setCollapsed(saved === "true");
        } catch { /* noop */ }

        // Listen for storage changes (from sidebar toggle)
        const handleStorage = () => {
            try {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved !== null) setCollapsed(saved === "true");
            } catch { /* noop */ }
        };

        // Poll localStorage since same-tab storage events don't fire
        const interval = setInterval(handleStorage, 200);
        return () => clearInterval(interval);
    }, []);

    const showSidebar = SIDEBAR_ROUTES.some(r => pathname.startsWith(r));

    if (!showSidebar) {
        return <>{children}</>;
    }

    const sidebarWidth = collapsed ? 64 : 220;

    return (
        <div className="flex min-h-screen">
            <AppSidebar />
            <div
                className="sidebar-content flex-1 min-w-0"
                style={{
                    marginLeft: `${sidebarWidth}px`,
                    transition: "margin-left 250ms cubic-bezier(0.4, 0, 0.2, 1)",
                }}
            >
                {children}
            </div>
        </div>
    );
}
