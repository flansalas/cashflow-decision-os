"use client";

import React, { createContext, useContext, useState, useCallback } from "react";

interface SpotlightState {
    isActive: boolean;
    targetId: string | null;
    message: string | null;
}

interface SpotlightContextType extends SpotlightState {
    focus: (targetId: string, message: string) => void;
    dismiss: () => void;
}

const SpotlightContext = createContext<SpotlightContextType | undefined>(undefined);

export function SpotlightProvider({ children }: { children: React.ReactNode }) {
    const [state, setState] = useState<SpotlightState>({
        isActive: false,
        targetId: null,
        message: null,
    });

    const focus = useCallback((targetId: string, message: string) => {
        setState({ isActive: true, targetId, message });
    }, []);

    const dismiss = useCallback(() => {
        setState({ isActive: false, targetId: null, message: null });
    }, []);

    return (
        <SpotlightContext.Provider value={{ ...state, focus, dismiss }}>
            {children}
        </SpotlightContext.Provider>
    );
}

export function useSpotlight() {
    const context = useContext(SpotlightContext);
    if (!context) {
        throw new Error("useSpotlight must be used within a SpotlightProvider");
    }
    return context;
}
