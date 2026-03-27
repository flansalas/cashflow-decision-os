// Landing page – smart CTA based on onboarding state
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingWizard } from "@/ui/OnboardingWizard";
import { BarChart3, Settings, Play, CornerDownLeft, Wallet } from "lucide-react";

type CompanyStatus =
  | { exists: false }
  | { exists: true; companyId: string; name: string; onboardingCompleted: boolean; onboardingStep: number };

export default function LandingPage() {
  const router = useRouter();
  const [status, setStatus] = useState<CompanyStatus | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const savedId = localStorage.getItem("cfdo_company_id");
    const url = savedId
      ? `/api/company/status?companyId=${savedId}`
      : `/api/company/status`;

    fetch(url)
      .then(r => r.json())
      .then((s: CompanyStatus) => {
        setStatus(s);
        // If they have an incomplete onboarding, update localStorage if needed
        if (s.exists && savedId !== s.companyId) {
          localStorage.setItem("cfdo_company_id", s.companyId);
        }
      })
      .catch(() => setStatus({ exists: false }))
      .finally(() => setChecking(false));
  }, []);

  const handleUseMyData = () => {
    setWizardOpen(true);
  };

  // CTA label logic
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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="max-w-lg w-full text-center space-y-8">
        {/* Logo / Title */}
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

        {/* CTAs */}
        <div className="space-y-3">
          {/* Primary: go straight to dashboard if company already completed */}
          {isCompleted ? (
            <button
              onClick={() => router.push(`/dashboard?companyId=${status!.companyId}`)}
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
            onClick={handleUseMyData}
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
        </div>

        {/* Footer */}
        <p className="text-xs text-gray-700">
          Single-user local app · No AI magic · No auth required
        </p>
      </div>

      {/* Onboarding Wizard Modal */}
      {wizardOpen && (
        <OnboardingWizard
          companyId={status?.exists ? status.companyId : undefined}
          startStep={status?.exists && !status.onboardingCompleted ? status.onboardingStep : 0}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
