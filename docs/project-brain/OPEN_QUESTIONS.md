# Open Questions

## Product vision
- The approved CONSTITUTION.md is the canonical product vision. Implementation reconciliation remains incomplete.

## Software architecture
- **Release Gate A Finding 1 (Resolved and Verified):** Sources, Settings, and standalone Scenarios expect `data.companyId` while the dashboard API returns `data.company.id`. Standardized on `data.company.id` contract.

## Data and forecasting
- **Release Gate A Finding 2 (Resolved and Verified):** `forecast-assembly.ts` builds `skipDatesByPattern` but does not consistently apply it to Managed recurring items. Managed recurring forecasts now apply `skip_recurring_occurrence` dates. Organic forecasts intentionally ignore management skip overrides.

## Weekly decision loop
- **Release Gate A Finding 3 (Resolved and Verified):** The cash-check-in learning path reads `amountExpected` while forecast breakdowns use `amount`. Cash check-ins now read `WeekBreakdownItem.amount` (expected baseline values no longer silently default to zero).
- **Release Gate A Finding 4 (Resolved and Verified):** Week close now requires successful checkpoint preservation. A failed checkpoint rolls back the week-close transaction and returns non-success. All four Gate A integrity findings are complete.

## AI and learning
- Hidden CFO AI is not implemented. Deterministic explanations and recommendations are partial. Financial and behavioral memory exist partially, but controlled outcome learning is not operational.

## Deployment and tenancy
- The authenticated Preview tenant behavior and the specifically audited Slice 1A/4A mutation routes were verified.
- Complete tenant coverage across every route and environment remains unverified.

## Documentation and knowledge
- Not yet verified through the recovery audit.

## Milestone 2: Action Accountability
- The next checkpoint is Milestone 2, Slice 8.
- Action completion and actual-effect review (Slice 6) is implemented and runtime-verified on the authorized Preview database.
- Controlled learning from action outcomes (Slice 7) is implemented and runtime-verified on the authorized Preview database (code commit: 27a9519, runtime verification commit: 64a9172).
- Owner-cockpit simplification and broader AI remain later work.
