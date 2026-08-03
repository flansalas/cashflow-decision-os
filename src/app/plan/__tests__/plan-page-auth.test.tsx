/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Page from '../page';
import * as clerkHooks from '@clerk/nextjs';

vi.mock('@clerk/nextjs', () => ({
    useOrganization: vi.fn(),
    useAuth: vi.fn(),
    RedirectToSignIn: () => <div data-testid="redirect-to-sign-in" />
}));

vi.mock('next/navigation', () => ({
    useSearchParams: () => new URLSearchParams(),
}));

describe('Plan Page Auth States', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows loading state when Clerk is loading', () => {
        vi.mocked(clerkHooks.useAuth).mockReturnValue({ isLoaded: false } as any);
        vi.mocked(clerkHooks.useOrganization).mockReturnValue({ isLoaded: false } as any);

        render(<Page />);
        expect(screen.getByText('Authenticating…')).toBeDefined();
    });

    it('redirects to sign in when signed out', () => {
        vi.mocked(clerkHooks.useAuth).mockReturnValue({ isLoaded: true, isSignedIn: false } as any);
        vi.mocked(clerkHooks.useOrganization).mockReturnValue({ isLoaded: true } as any);

        render(<Page />);
        expect(screen.getByTestId('redirect-to-sign-in')).toBeDefined();
    });

    it('shows organization selection message when signed in but no org selected', () => {
        vi.mocked(clerkHooks.useAuth).mockReturnValue({ isLoaded: true, isSignedIn: true } as any);
        vi.mocked(clerkHooks.useOrganization).mockReturnValue({ isLoaded: true, organization: null } as any);

        render(<Page />);
        expect(screen.getByText('Please select an organization')).toBeDefined();
        expect(screen.getByText('You must select an active organization to view this dashboard.')).toBeDefined();
    });
});
