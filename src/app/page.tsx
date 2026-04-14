// Landing page — explicit authenticated vs. anonymous modes
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, useOrganization } from "@clerk/nextjs";
import { OnboardingWizard } from "@/ui/OnboardingWizard";
import { BarChart3, Settings, Play, CornerDownLeft, Wallet, Building2, LogIn } from "lucide-react";

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
// Only renders when Clerk confirms isSignedIn. Never touches localStorage or Pilot data.
function AuthenticatedHomepage() {
  const router = useRouter();
  const { organization, isLoaded: isOrgLoaded } = useOrganization();

  // Auto-redirect once org is confirmed
  useEffect(() => {
    if (!isOrgLoaded) return;
    if (organization) {
      console.log(`[LandingPage][auth] Active org: "${organization.name}" (${organization.id}). Redirecting to /dashboard (no companyId).`);
      localStorage.removeItem("cfdo_company_id");
      router.replace("/dashboard");
    } else {
      console.log("[LandingPage][auth] Signed in but no active org yet. Waiting for org selection.");
    }
  }, [isOrgLoaded, organization, router]);

  // Show a loading spinner while org is resolving
  if (!isOrgLoaded || organization) {
    return (
      <PageShell>
        <div className="space-y-4">
          <div className="flex justify-center">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="text-gray-400 text-sm">
            {organization ? "Entering your dashboard…" : "Loading your session…"}
          </p>
        </div>
      </PageShell>
    );
  }

  // Signed in but no org — prompt them to select or create one
  return (
    <PageShell>
      <div className="space-y-4">
        <div className="p-4 bg-yellow-900/30 border border-yellow-700/50 rounded-lg text-left">
          <p className="text-yellow-300 text-sm font-medium flex items-center gap-2">
            <Building2 className="w-4 h-4 flex-shrink-0" />
            No active organization found
          </p>
          <p className="text-yellow-200/70 text-xs mt-1">
            Your account doesn&apos;t have an active company selected. Please use the Organization Switcher in the dashboard sidebar to select your company, or contact your administrator.
          </p>
        </div>
        <button
          onClick={() => {
            console.log("[LandingPage][auth] No-org user manually navigating to /dashboard.");
            router.push("/dashboard");
          }}
          className="w-full py-3.5 px-6 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-[8px] transition-colors border border-emerald-500 text-base flex items-center justify-center gap-2"
        >
          <BarChart3 className="w-5 h-5" /> Go to Dashboard
        </button>
      </div>
    </PageShell>
  );
}

// ─── Anonymous mode ────────────────────────────────────────────────────────────
// Only renders when Clerk confirms user is NOT signed in. Full legacy Pilot/demo behavior.
function AnonymousHomepage() {
  const router = useRouter();
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const savedId = localStorage.getItem("cfdo_company_id");
    const url = savedId
      ? `/api/company/status?companyId=${savedId}`
      : `/api/company/status`;

    console.log(`[LandingPage][anon] Loading company status. savedId=${savedId}`);
    fetch(url)
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

  let ctaLabel: React.ReactNode = (
    <span className="flex items-center justify-center gap-2">
      <BarChart3 className="w-5 h-5" /> Use My Data
    </span>
  );
  let ctaSub = "";
  const isCompleted = !checking && status?.exists && status.onboardingCompleted;
  if (!checking && status?.exists) {
    if (status.onboardingCompleted) {
      ctaLabel = (
        <span className="flex items-center justify-center gap-2">
          <Settings className="w-5 h-5" /> Re-configure Setup
        </span>
      );
      ctaSub = status.name;
    } else {
      ctaLabel = (
        <span className="flex items-center justify-center gap-2">
          <CornerDownLeft className="w-5 h-5" /> Continue Setup
        </span>
      );
      ctaSub = `Step ${status.onboardingStep + 1} of 5 — ${status.name}`;
    }
  }

  return (
    <PageShell>
      <div className="space-y-3">
        {isCompleted ? (
          <button
            onClick={() => {
              console.log(`[LandingPage][anon] Go to Dashboard clicked. companyId=${status!.companyId}`);
              router.push(`/dashboard?companyId=${status!.companyId}`);
            }}
            className="w-full py-3.5 px-6 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-[8px] transition-colors border border-emerald-500 text-base flex flex-col items-center justify-center gap-1"
          >
            <span className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" /> Go to Dashboard
            </span>
            <span className="block text-xs text-emerald-100 font-normal">{status!.name}</span>
          </button>
        ) : (
          <button
            onClick={() => router.push("/dashboard")}
            className="w-full py-3.5 px-6 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-[8px] transition-colors border border-emerald-500 text-base flex items-center justify-center gap-2"
          >
            <Play className="w-5 h-5 fill-current" /> View Demo
          </button>
        )}

        <button
          onClick={() => setWizardOpen(true)}
          disabled={checking}
          className="w-full py-3.5 px-6 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-[8px] transition-colors border border-gray-700 hover:border-gray-600 text-base disabled:opacity-60 flex flex-col items-center justify-center gap-1"
        >
          {checking ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 border-2 border-gray-500 border-t-white rounded-full animate-spin" />
              Checking…
            </span>
          ) : (
            <>
              {ctaLabel}
              {ctaSub && <span className="block text-xs text-gray-400 font-normal">{ctaSub}</span>}
            </>
          )}
        </button>

        {/* Sign-in nudge for users who have accounts */}
        <div className="pt-2">
          <a
            href="/sign-in"
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center gap-1.5"
          >
            <LogIn className="w-3.5 h-3.5" /> Sign in to your company account
          </a>
        </div>
      </div>

      <p className="text-xs text-gray-700">
        Single-user local app · No AI magic · No auth required
      </p>

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

  // While Clerk is initializing, show nothing (avoids flash of anonymous UI for signed-in users)
  if (!isAuthLoaded) {
    console.log("[LandingPage] Clerk not yet loaded. Holding render.");
    return (
      <PageShell>
        <div className="flex justify-center">
          <div className="w-8 h-8 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageShell>
    );
  }

  console.log(`[LandingPage] Clerk loaded. isSignedIn=${isSignedIn}. Choosing mode.`);

  // Hard split: never allow authenticated state to bleed into anonymous mode or vice versa
  if (isSignedIn) {
    return <AuthenticatedHomepage />;
  }

  return <AnonymousHomepage />;
}
