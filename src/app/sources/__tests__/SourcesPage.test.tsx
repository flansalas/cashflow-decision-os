// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SourcesPage from '../page';

// Mock the upload steps to isolate the onDone callback logic
vi.mock('@/ui/ARAPUploadStep', () => ({
    ARAPUploadStep: () => <div data-testid="arap-step">ARAP Step</div>
}));

vi.mock('@/ui/BankUploadStep', () => ({
    BankUploadStep: ({ onDone }: { onDone: () => void }) => (
        <div data-testid="bank-step">
            <button onClick={onDone} data-testid="mock-skip-button">Skip & Go to Dashboard</button>
        </div>
    )
}));

describe("SourcesPage UI Upload Loop", () => {
    let originalLocation: any;
    let alertMock: any;

    beforeEach(() => {
        // Setup window.location mock
        originalLocation = window.location;
        delete (window as any).location;
        window.location = { href: "" } as any;

        // Mock alert to catch the old loop behavior
        alertMock = vi.fn();
        window.alert = alertMock;

        // Mock fetch to simulate dashboard returning a company
        global.fetch = vi.fn().mockResolvedValue({
            json: () => Promise.resolve({ company: { id: "test-company" } })
        });
    });

    afterEach(() => {
        window.location = originalLocation;
        vi.restoreAllMocks();
    });

    it("should resolve the upload loop by redirecting to /plan and preventing duplicate alerts", async () => {
        render(<SourcesPage />);
        
        // Wait for companyId to load and UI to reveal tabs
        const bankTab = await screen.findByText("Bank Statement");
        
        // Switch to the Bank Statement tab
        fireEvent.click(bankTab);
        
        // Find the Skip button that triggers onDone
        const skipButton = await screen.findByTestId("mock-skip-button");
        
        // In the original broken implementation, clicking this called alert()
        // and because state didn't change, the user could click it repeatedly.
        // We simulate clicking it multiple times to ensure the loop is broken.
        fireEvent.click(skipButton);
        fireEvent.click(skipButton);
        fireEvent.click(skipButton);
        
        // Verify the old broken alert() behavior is completely gone
        expect(alertMock).not.toHaveBeenCalled();
        
        // Verify we get redirected to the dashboard (/plan) exactly once
        expect(window.location.href).toBe("/plan");
    });
});
