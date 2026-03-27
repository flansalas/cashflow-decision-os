// ui/HelpBubble.tsx – Tiny contextual help popover (? icon)
"use client";

import { useState, useRef, useEffect } from "react";
import { HelpCircle } from "lucide-react";

interface Props {
    text: string;
    /** Position of the popover relative to the icon */
    position?: "bottom" | "bottom-right" | "left";
}

export function HelpBubble({ text, position = "bottom" }: Props) {
    const [show, setShow] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        if (!show) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setShow(false);
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [show]);

    const positionClasses: Record<string, string> = {
        "bottom": "left-1/2 -translate-x-1/2 top-full mt-2",
        "bottom-right": "left-0 top-full mt-2",
        "left": "right-full top-1/2 -translate-y-1/2 mr-2",
    };

    return (
        <div ref={ref} className="relative inline-flex items-center">
            <button
                onClick={() => setShow(!show)}
                onMouseEnter={() => setShow(true)}
                onMouseLeave={() => setShow(false)}
                className="w-4 h-4 flex items-center justify-center rounded-full transition-all opacity-40 hover:opacity-80"
                style={{ color: "var(--text-muted)" }}
            >
                <HelpCircle className="w-3.5 h-3.5" />
            </button>
            {show && (
                <div
                    className={`absolute z-[70] w-56 rounded-xl border p-3 shadow-xl text-xs leading-relaxed ${positionClasses[position]}`}
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
                    {text}
                </div>
            )}
        </div>
    );
}
