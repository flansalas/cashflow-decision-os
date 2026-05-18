# Project Memory

**Last Updated:** 2026-05-18 / Pending Commit

## 1. Last Completed Milestone

Persistent project documentation layer created.

- Commit hash: 25a1e95e28334623143e9c6c490ef546d9285384
- Files created or updated: README.md, PRODUCT.md, ARCHITECTURE.md, AGENTS.md, GEMINI.md
- Purpose: preserve product doctrine, architecture context, and AI-agent operating rules across future AG sessions.

## 2. Current State vs. Product Vision

Product vision:

Cash Flow Decision OS is not a generic cash flow dashboard. It is a weekly cash decision engine for owner-led SMEs.

Core loop:

Data → Forecast → Explain → Decide → Simulate → Intervene → Verify → Learn

Current strengths:

- Deterministic forecast foundation exists.
- Dashboard and forecast visualization exist.
- AR/AP handling exists.
- Recurring commitments and cash entry concepts exist.
- Override and audit concepts exist.
- Action/recommendation and scenario concepts are emerging.

Current gaps:

- The action engine is not yet the full product moat.
- Simulation-backed action recommendations are not yet mature.
- The verification/learning loop is still the major missing capability.
- The product must avoid drifting into a generic cash flow dashboard.

## 3. Active Focus / Current Constraint

Complete the smallest useful weekly cash decision loop.

Current movement:

forecast → explanation

Target movement:

forecast → explanation → recommended action → simulated impact → owner decision → verification

## 4. Next Safest Implementation Slice

Before implementing new features, inspect the current action/recommendation and scenario/what-if code paths.

The next safest product slice is to identify the smallest way to connect one recommended cash action to one simulated forecast impact.

No implementation should begin until explicitly approved.

## 5. Near-Term Roadmap

NOW:
- Stabilize and clarify the weekly decision loop.
- Audit action/recommendation and scenario/what-if code paths.
- Identify the smallest simulation-backed action slice.

NEXT:
- Build Weekly Decision Queue V1.
- Show collect/delay/protect/monitor actions.
- Show estimated cash impact for at least one action type.

LATER:
- Add verification loop.
- Track recommended action vs. actual result.
- Learn from customer/vendor/payment behavior.
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
- Generic SaaS dashboard drift.
- Overbuilding before the weekly decision loop works.
- Auth/tenancy fragility.
- Stale documentation if MEMORY.md is not maintained.

## 7. Do Not Touch Without Approval

- Auth/Clerk/tenancy behavior.
- Prisma schema and migrations.
- Forecast calculation logic.
- Dashboard financial totals.
- AR/AP exclusion and override behavior.
- Environment configuration.
- Deployment configuration.
