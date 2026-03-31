// ui/HelpBubble.tsx – Unified contextual help popover (? icon)
// Accepts either plain `text` string or rich `content` ReactNode.
"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

interface Props {
    /** Simple plain-text explanation */
    text?: string;
    /** Rich JSX content (can be used instead of `text`) */
    content?: ReactNode;
    /** Position of the popover relative to the icon */
    position?: "bottom" | "bottom-right" | "bottom-left" | "left" | "top";
    /** Width override, e.g. "w-72" */
    width?: string;
}

export function HelpBubble({ text, content, position = "bottom", width = "w-56" }: Props) {
    const [show, setShow] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on click / touch outside
    useEffect(() => {
        if (!show) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [show]);

    const positionClasses: Record<string, string> = {
        "bottom":      "left-1/2 -translate-x-1/2 top-full mt-2",
        "bottom-right":"left-0 top-full mt-2",
        "bottom-left": "right-0 top-full mt-2",
        "left":        "right-full top-1/2 -translate-y-1/2 mr-2",
        "top":         "left-1/2 -translate-x-1/2 bottom-full mb-2",
    };

    return (
        <div ref={ref} className="relative inline-flex items-center">
            <button
                onClick={() => setShow(!show)}
                onMouseEnter={() => setShow(true)}
                onMouseLeave={() => setShow(false)}
                className="w-4 h-4 flex items-center justify-center rounded-full transition-all opacity-40 hover:opacity-80"
                style={{ color: "var(--text-muted)" }}
                aria-label="Help"
            >
                <HelpCircle className="w-3.5 h-3.5" />
            </button>
            {show && (
                <div
                    className={`absolute z-[70] ${width} rounded-xl border p-3 shadow-xl text-xs leading-relaxed ${positionClasses[position]}`}
                    style={{
                        background: "var(--bg-base)",
                        borderColor: "var(--border-default)",
                        color: "var(--text-secondary)",
                        backdropFilter: "blur(12px)",
                        textTransform: "none",
                        letterSpacing: "normal",
                        fontWeight: "normal",
                    }}
                >
                    {content ?? text}
                </div>
            )}
        </div>
    );
}

