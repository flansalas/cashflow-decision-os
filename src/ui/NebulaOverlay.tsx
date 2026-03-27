"use client";

import React, { useState, useEffect, useLayoutEffect, useCallback } from "react";
import { useSpotlight } from "./SpotlightContext";
import { Sparkles } from "lucide-react";

export function NebulaOverlay() {
    const { isActive, targetId, message, dismiss } = useSpotlight();
    const [rect, setRect] = useState<DOMRect | null>(null);

    const updateRect = useCallback(() => {
        if (!targetId) return;
        const el = document.getElementById(targetId);
        if (el) {
            setRect(el.getBoundingClientRect());
        }
    }, [targetId]);

    useLayoutEffect(() => {
        if (isActive && targetId) {
            updateRect();
            // Update on scroll or resize to keep the hole aligned
            window.addEventListener("scroll", updateRect, true);
            window.addEventListener("resize", updateRect);
            return () => {
                window.removeEventListener("scroll", updateRect, true);
                window.removeEventListener("resize", updateRect);
            };
        } else {
            setRect(null);
        }
    }, [isActive, targetId, updateRect]);

    if (!isActive || !rect) return null;

    return (
        <>
            {/* Invisible Click-To-Dismiss Layer (Blocks interaction outside target) */}
            <div 
                className="fixed inset-0 z-[9998] cursor-default pointer-events-auto" 
                onClick={dismiss} 
            />

            {/* Target Highlight Ring (A soft blue glow around the actual button) */}
            <div 
                className="fixed z-[9999] pointer-events-none rounded-lg animate-in fade-in zoom-in duration-500"
                style={{
                    top: rect.top - 4,
                    left: rect.left - 4,
                    width: rect.width + 8,
                    height: rect.height + 8,
                    border: "2px solid #3b82f6",
                    boxShadow: "0 0 20px rgba(59,130,246,0.3), inset 0 0 10px rgba(59,130,246,0.2)",
                    background: "rgba(59,130,246,0.05)"
                }}
            />

            {/* Bouncing Pointer Arrow (Bouncing vertically above the button) */}
            <div 
                className="fixed z-[10000] pointer-events-none animate-bounce-vertical"
                style={{
                    top: rect.top - 45,
                    left: rect.left + rect.width / 2 - 10,
                }}
            >
                <div className="w-5 h-8 flex items-center justify-center">
                    <div className="w-0 h-0 border-l-[10px] border-l-transparent border-r-[10px] border-r-transparent border-t-[15px] border-t-blue-500 drop-shadow-lg" />
                </div>
            </div>

            {/* The Coach Card (Centered above the button) */}
            <div
                className="fixed z-[10000] pointer-events-none animate-in zoom-in-95 slide-in-from-bottom-4 duration-500 ease-out"
                style={{
                    top: rect.top - 180,
                    left: rect.left + rect.width / 2 - 150,
                    width: "300px"
                }}
            >
                <div 
                    className="p-4 rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.3)] border-2 flex flex-col gap-2"
                    style={{ 
                        background: "var(--bg-surface)", 
                        borderColor: "#3b82f6",
                        backdropFilter: "blur(20px)",
                        color: "var(--text-primary)",
                    }}
                >
                    <div className="flex items-center gap-2 mb-0.5">
                        <div className="w-5 h-5 rounded bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Sparkles className="w-3 h-3 text-white" />
                        </div>
                        <span className="text-[10px] uppercase tracking-widest font-extrabold text-blue-500">Nebula Guide</span>
                    </div>
                    <p className="text-[14px] leading-snug font-bold">
                        {message}
                    </p>
                    <div className="text-[9px] text-slate-500 font-bold uppercase tracking-tight opacity-60">
                        Click the highlighted button below
                    </div>
                </div>
                
                {/* Arrow pointing down to the button */}
                <div 
                    className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 border-r-2 border-b-2"
                    style={{ background: "var(--bg-surface)", borderColor: "#3b82f6" }}
                />
            </div>

            <style jsx global>{`
                @keyframes bounce-vertical {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-8px); }
                }
                .animate-bounce-vertical {
                    animation: bounce-vertical 0.8s infinite ease-in-out;
                }
            `}</style>
        </>
    );
}
