# Open Questions

## Product vision
- The approved CONSTITUTION.md is the canonical product vision. Implementation reconciliation remains incomplete.

## Software architecture
- **Release Gate A Finding 1 (Resolved and Verified):** Sources, Settings, and standalone Scenarios expect `data.companyId` while the dashboard API returns `data.company.id`. Standardized on `data.company.id` contract.

## Data and forecasting
- **Release Gate A Finding 2 (Open/Unapproved):** `forecast-assembly.ts` builds `skipDatesByPattern` but does not consistently apply it to Managed recurring items.

## Weekly decision loop
- **Release Gate A Finding 3 (Open/Unapproved):** The cash-check-in learning path reads `amountExpected` while forecast breakdowns use `amount`.
- **Release Gate A Finding 4 (Open/Unapproved):** Week-close checkpoint preservation is not enforced as a required successful step.

## AI and learning
- Hidden CFO AI is not implemented. Deterministic explanations and recommendations are partial. Financial and behavioral memory exist partially, but controlled outcome learning is not operational.

## Deployment and tenancy
- The authenticated Preview tenant behavior and the specifically audited Slice 1A/4A mutation routes were verified.
- Complete tenant coverage across every route and environment remains unverified.

## Documentation and knowledge
- Not yet verified through the recovery audit.
