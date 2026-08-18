# Project Memory

**Last Updated:** 2026-08-17 / Weekly bank-coverage evidence fix

## 1. Last Completed Milestone

Package 4A canonical evaluation safety foundation implemented and locally verified.

- Production is serving main SHA `ee04afa12811e84a4866e7e7807634f3c8c06ad6`, including Package 4A and the AR/AP import metadata fix.
- Package 4A evaluates only tenant-bound, sealed canonical 13-week forecasts whose persisted weeks match the sealed payload and hash.
- Week 1 maps to forecast index 0 and its actual calendar week; the former one-week offset is removed.
- Manual evaluation resolves the signed-in tenant and rejects caller-supplied foreign company authority.
- Evaluation jobs are tenant-bound and respect `retryAfter`; completed and retried jobs release stale claim state.
- Current and legacy terminal transfer statuses (`confirmed` and `resolved`) are excluded from residual actual cash.
- Observations remain `attributionAmbiguity = not_assessed` until a later package establishes attribution clarity; they must not become automatic learning authority.
- Verification: 24 focused tests, TypeScript no-emit check, targeted lint, and diff integrity all passed without production database access.
- A narrow weekly bank-coverage correction is implemented and locally verified, pending commit and release:
  - clean, certified manifest intervals and valid account-specific no-activity intervals compose into continuous weekly coverage;
  - distinct no-activity intervals for the same bank account remain active together, while an exact duplicate replaces only its prior duplicate;
  - no-activity evidence is ignored when current bank transactions contradict it;
  - any uncovered time gap still fails closed;
  - fresh uncertified bank manifests remain visible for certification even when an older cash snapshot reports bank coverage as decision-ready;
  - 17 focused isolated route/service tests, the preceding readiness UI regression tests, and the TypeScript no-emit check passed without production database mutation.

## 2. Current State vs. Product Vision

Product vision:

Cash Flow Decision OS is not a generic cash flow dashboard. It is a weekly cash decision engine for owner-led SMEs.

Core loop:

Data → Forecast → Explain → Decide → Simulate → Intervene → Verify → Learn

Current strengths:

- Deterministic forecast foundation exists.
- Immutable sealed forecast versions and governed Package 3 certification exist.
- Dashboard, forecast visualization, AR/AP, recurring commitments, overrides, scenarios, and audit records exist.
- Package 4A now has tenant-safe canonical horizon evaluation and retry controls.

Current gaps:

- Cascio has no sealed canonical forecast or authoritative matured evaluation evidence yet.
- Full actual-cash attribution, evaluation-run integration, and governed learning eligibility remain Package 4B+ work.
- No learning proposal may automatically modify forecast assumptions; owner approval remains required.

## 3. Active Focus / Current Constraint

Release the weekly bank-coverage evidence fix without disrupting the working production app, then complete Cascio's verified weekly close using only certified source evidence.

Current movement:

sealed forecast → governed decision → safe matured-horizon measurement

Target movement:

sealed forecast → actual attribution → verified evaluation → proposed learning → owner approval

## 4. Next Safest Implementation Slice

Commit and release the weekly bank-coverage evidence fix, verify the exact production SHA and authenticated tenant behavior, then certify the real Cascio bank manifests and exact no-activity intervals before advancing the week.

Advance only when the closing week has continuous verified coverage across every active account. After that, design Package 4B around the existing attribution and evaluation authorities rather than creating a parallel learning path.

No implementation should begin until explicitly approved.

## 5. Near-Term Roadmap

NOW:
- Release and smoke-verify the weekly bank-coverage evidence fix.
- Complete Cascio's evidence-backed weekly close without synthetic financial records.
- Preserve production stability and existing Cascio financial records.
- Establish the first legitimate sealed weekly forecast before evaluating or learning from it.

NEXT:
- Integrate deterministic actual-cash attribution with canonical evaluation runs.
- Define explicit learning eligibility that requires complete bank coverage and clear attribution evidence.
- Present proposed changes for owner review without automatic application.

LATER:
- Track forecast and intervention performance across repeated weekly cycles.
- Learn from customer, vendor, and payment behavior only after sufficient verified evidence.
- Add human-approved execution support.

DO NOT BUILD YET:
- Full autonomous execution.
- Complex Markov chain engine.
- Deep learning forecasting.
- Multi-agent orchestration.
- Overbuilt dashboard redesign.
- Full QuickBooks dependency before pilot learning.

## 6. Active Risks

- Financial correctness drift between dashboard totals, forecast totals, and AR/AP grid totals.
- Forecast trust failure if assumptions are unclear.
- Treating incomplete or attribution-ambiguous observations as learning authority.
- Reintroducing cross-tenant evaluator or worker paths.
- Overbuilding before Cascio completes repeated real weekly cycles.
- Stale documentation if MEMORY.md is not maintained.

## 7. Do Not Touch Without Approval

- Auth/Clerk/tenancy behavior.
- Prisma schema and migrations.
- Forecast calculation logic.
- Dashboard financial totals.
- AR/AP exclusion and override behavior.
- Environment configuration.
- Deployment configuration.
