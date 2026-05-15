// Landing page — explicit authenticated vs. anonymous modes
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrganization, useOrganizationList } from "@clerk/nextjs";
import { OnboardingWizard } from "@/ui/OnboardingWizard";
import { BarChart3, Settings, Play, CornerDownLeft, Wallet, Building2, LogIn, ChevronRight, Check } from "lucide-react";

type CompanyStatus =
  | { exists: false }
  | { exists: true; companyId: string; name: string; onboardingCompleted: boolean; onboardingStep: number };

// ─── Shared shell (logo + title) ──────────────────────────────────────────────
function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="max-w-lg w-full text-center space-y-8">
        <div className="space-y-4">
          <div className="flex justify-center mb-6 mt-4">
            <div className="w-16 h-16 bg-[#1e293b] border border-[#334155] rounded-[8px] shadow-sm flex items-center justify-center">
              <Wallet className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Cash Flow Decision OS
          </h1>
          <p className="text-gray-400 text-lg leading-relaxed">
            Know if you&apos;ll run out of cash and what to do this week.
          </p>
          <p className="text-gray-600 text-sm">
            v0.1 &ldquo;Tire Swing&rdquo; — deterministic, explainable, fast.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Authenticated mode ────────────────────────────────────────────────────────
// Only renders when Clerk confirms isSignedIn.
function AuthenticatedHomepage() {
  const router = useRouter();
  const { userId } = useAuth();
  const { organization, isLoaded: isOrgLoaded } = useOrganization();
  const { isLoaded: listLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  });

  const memberships = userMemberships.data ?? [];
  const isMultiOrg = listLoaded && memberships.length > 1;
  const isSingleOrg = listLoaded && memberships.length === 1;

  // Single-org: auto-activate and redirect immediately
  useEffect(() => {
    if (!isOrgLoaded || !listLoaded) return;
    if (isSingleOrg) {
      if (!organization && setActive && memberships[0]) {
        // Auto-activate the single organization if none is active
        setActive({ organization: memberships[0].organization.id }).then(() => {
          localStorage.removeItem("cfdo_company_id");
          router.replace("/dashboard");
        });
      } else if (organization) {
        // Already active, proceed to dashboard
        localStorage.removeItem("cfdo_company_id");
        router.replace("/dashboard");
      }
    }
    // Multi-org users: do NOT auto-redirect — show the selection card below
  }, [isOrgLoaded, listLoaded, isSingleOrg, organization, router, setActive, memberships]);

  // Still loading Clerk state or fetching membership data
  if (!isOrgLoaded || !listLoaded || userMemberships.isLoading) {
    return (
      <PageShell>
        <div className="flex justify-center">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageShell>
    );
  }

  // Single-org user: show redirect spinner while activating or redirecting
  if (isSingleOrg) {
    return (
      <PageShell>
        <div className="space-y-3 text-center">
          <div className="flex justify-center">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="text-gray-400 text-sm">Entering your dashboard…</p>
        </div>
      </PageShell>
    );
  }

  // Multi-org user: show explicit company chooser
  if (isMultiOrg) {
    return (
      <PageShell>
        <div className="space-y-3 text-left">
          <p className="text-gray-400 text-sm text-center mb-1">Select a company to continue</p>
          {memberships.map(m => {
            const isActive = organization?.id === m.organization.id;
            return (
              <button
                key={m.organization.id}
                onClick={async () => {
                  if (setActive) {
                    await setActive({ organization: m.organization.id });
                    localStorage.removeItem("cfdo_company_id");
                    localStorage.setItem("cfdo_last_org_id", m.organization.id);
                    router.replace("/dashboard");
                  }
                }}
                className={`w-full flex items-center justify-between px-4 py-3.5 rounded-[8px] border transition-all ${
                  isActive
                    ? "bg-emerald-900/30 border-emerald-600/60 text-white"
                    : "bg-gray-800 border-gray-700 hover:border-gray-500 hover:bg-gray-700/80 text-gray-200"
                }`}
              >
                <span className="flex items-center gap-3">
                  <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
                  <span className="font-medium text-sm">{m.organization.name}</span>
                </span>
                {isActive
                  ? <Check className="w-4 h-4 text-emerald-400" />
                  : <ChevronRight className="w-4 h-4 text-gray-500" />
                }
              </button>
            );
          })}
        </div>
      </PageShell>
    );
  }

  // Signed in but no org memberships at all
  console.log("CFDO Diagnostic:", {
    userId,
    activeOrgId: organization?.id,
    isOrgLoaded,
    listLoaded,
    isLoading: userMemberships.isLoading,
    isFetching: userMemberships.isFetching,
    isError: userMemberships.isError,
    errorMessage: userMemberships.error?.message,
    membershipsLength: memberships.length,
    membershipIds: memberships.map(m => m.organization.id)
  });

  return (
    <PageShell>
      <div className="space-y-4">
        <div className="p-4 bg-yellow-900/30 border border-yellow-700/50 rounded-lg text-left">
          <p className="text-yellow-300 text-sm font-medium flex items-center gap-2">
            <Building2 className="w-4 h-4 flex-shrink-0" />
            No active organization found
          </p>
          <p className="text-yellow-200/70 text-xs mt-1">
            Your account isn&apos;t linked to a company yet. Contact your administrator.
          </p>
        </div>
        <a
          href="/sign-in"
          className="w-full py-3 px-6 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-[8px] transition-colors border border-gray-700 text-sm flex items-center justify-center gap-2"
        >
          <LogIn className="w-4 h-4" /> Sign in with a different account
        </a>
        
        <div className="mt-6 text-left text-[10px] text-gray-500 font-mono break-all p-3 bg-gray-900/50 rounded border border-gray-800">
          <p className="font-bold text-gray-400 mb-1">Diagnostic Info</p>
          <p>User: {userId || "none"}</p>
          <p>Active Org: {organization?.id || "none"}</p>
          <p>Flags: orgLoaded={String(isOrgLoaded)} listLoaded={String(listLoaded)} isLoading={String(userMemberships.isLoading)} isFetching={String(userMemberships.isFetching)}</p>
          {userMemberships.isError && <p className="text-red-400">Error: {userMemberships.error?.message}</p>}
          <p>Memberships ({memberships.length}): {memberships.map(m => m.organization.name).join(", ")}</p>
        </div>
      </div>
    </PageShell>
  );
}

// ─── Anonymous / public landing ────────────────────────────────────────────────
// Only renders when Clerk confirms user is NOT signed in.
// SECURITY: Never resolves tenant state for visitors without an explicit companyId.
function AnonymousPublicPage() {
  const router = useRouter();
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Only check status if the user previously saved a companyId in this browser.
    const savedId = localStorage.getItem("cfdo_company_id");
    if (!savedId) {
      setChecking(false);
      return;
    }
    fetch(`/api/company/status?companyId=${savedId}`)
      .then(r => r.json())
      .then((s: CompanyStatus) => {
        setStatus(s);
        if (s.exists && savedId !== s.companyId) {
          localStorage.setItem("cfdo_company_id", s.companyId);
        }
      })
      .catch(() => setStatus({ exists: false }))
      .finally(() => setChecking(false));
  }, []);

  const hasReturningSetup = !checking && status?.exists && !status.onboardingCompleted;
  const hasCompletedSetup = !checking && status?.exists && status.onboardingCompleted;

  return (
    <PageShell>
      <div className="space-y-3">

        {/* PRIMARY: Sign in — always first and most prominent */}
        <a
          href="/sign-in"
          className="w-full py-4 px-6 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-semibold rounded-[8px] transition-all border border-emerald-500 text-base flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-900/30"
        >
          <LogIn className="w-5 h-5" />
          Sign in to your account
        </a>

        <div className="relative flex items-center gap-3 py-1">
          <div className="flex-1 h-px bg-gray-800" />
          <span className="text-xs text-gray-600 font-medium tracking-wide uppercase">or</span>
          <div className="flex-1 h-px bg-gray-800" />
        </div>

        {/* SECONDARY: Returning setup / completed user shortcut */}
        {hasCompletedSetup && (
          <button
            onClick={() => router.push(`/dashboard?companyId=${status!.companyId}`)}
            className="w-full py-3.5 px-6 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-[8px] transition-colors border border-gray-700 hover:border-gray-600 text-sm flex flex-col items-center justify-center gap-0.5"
          >
            <span className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> Open My Dashboard
            </span>
            <span className="text-xs text-gray-400 font-normal">{status!.name}</span>
          </button>
        )}

        {hasReturningSetup && (
          <button
            onClick={() => setWizardOpen(true)}
            className="w-full py-3.5 px-6 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-[8px] transition-colors border border-gray-700 hover:border-gray-600 text-sm flex flex-col items-center justify-center gap-0.5"
          >
            <span className="flex items-center gap-2">
              <CornerDownLeft className="w-4 h-4" /> Continue Setup
            </span>
            <span className="text-xs text-gray-400 font-normal">
              Step {status!.onboardingStep + 1} of 5 — {status!.name}
            </span>
          </button>
        )}

        {/* New setup — only if no returning session */}
        {!checking && !status?.exists && (
          <button
            onClick={() => setWizardOpen(true)}
            className="w-full py-3.5 px-6 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-[8px] transition-colors border border-gray-700 hover:border-gray-600 text-sm flex items-center justify-center gap-2"
          >
            <Settings className="w-4 h-4" /> Set up a new company
          </button>
        )}
      </div>

      {wizardOpen && (
        <OnboardingWizard
          companyId={status?.exists ? status.companyId : undefined}
          startStep={status?.exists && !status.onboardingCompleted ? status.onboardingStep : 0}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </PageShell>
  );
}



// ─── Root — gates on Clerk load state, then picks mode ────────────────────────
export default function LandingPage() {
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();

  // While Clerk is initializing, hold render to avoid flash of anonymous UI for signed-in users
  if (!isAuthLoaded) {
    return (
      <PageShell>
        <div className="flex justify-center">
          <div className="w-8 h-8 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageShell>
    );
  }

  // Hard split: never allow authenticated state to bleed into anonymous mode or vice versa
  if (isSignedIn) {
    return <AuthenticatedHomepage />;
  }

  return <AnonymousPublicPage />;
}

