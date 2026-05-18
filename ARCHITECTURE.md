# Architecture

## 1. Current Stack
- **Frontend & API**: Next.js (App Router), TypeScript, Tailwind CSS
- **Database**: PostgreSQL (Neon) with Prisma ORM
- **Auth & Tenancy**: Clerk (Organizations for multi-tenant support)
- **Deployment**: Vercel

## 2. Directory Structure Overview
- `src/app/api`: Backend API routes (REST/Next.js route handlers). Includes subdirectories for `assumptions`, `audit`, `cash-categories`, `cash-entries`, `company`, `dashboard`, `ingest`, `onboarding`, `overrides`, `recurring-reschedule`, `scenarios`, `search`, `triage`, `upload`.
- `src/lib`: Core utilities, including `tenant.ts` for tenant resolution.
- `prisma`: Contains `schema.prisma` mapping out the database models.
- `scripts`: Maintenance and test scripts.
- `src/ui`: React components (e.g., ForecastPulseView, CashflowGrid, GlobalSearch).

## 3. Main Data Models (Prisma)
- **Tenancy**: `Company`
- **Cash**: `CashSnapshot`, `CashFlowCategory`, `CashFlowEntry`
- **Ledger/Operations**: `Invoice` (AR), `Bill` (AP), `Customer`, `Vendor`
- **Forecast & Memory**: `ForecastWeek`, `ForecastCheckpoint`, `Assumption`, `RecurringCommitment`
- **Overrides & Actions**: `Override`, `ChangeLog`, `ActionItem`, `ScenarioItem`

## 4. Main API Routes
- `api/dashboard`: Computes the main forecast.
- `api/onboarding/*`: Setup workflows.
- `api/ingest/*` & `api/upload/*`: Data ingestion.
- `api/overrides`: Manages user adjustments to the forecast.
- `api/scenarios`: What-if analysis.
- `api/triage`: Handles backlog and action item resolutions.
- `api/audit`: Audit logs.

## 5. Forecast Engine Files and Responsibilities
- The forecast engine (invoked via `api/dashboard` and potentially `api/cashflow`) is responsible for combining static ledger data (AR/AP), recurring commitments, cash entries, and overrides into a unified weekly projection (`ForecastWeek`).
- It uses deterministic logic to calculate inflows, outflows, and ending cash balances per week.

## 6. Dashboard/UI Components and Responsibilities
- `ForecastPulseView`, `CashflowGrid`: Visualize the 13-week forecast and pulse metrics.
- `GettingStartedTracker`, `HelpBubble`, `NebulaOverlay`: Provide user guidance and trust-building UX.
- `WhyWeekModal`, `GlobalSearch`: Enable drill-down explanation and navigation.

## 7. Existing AR/AP Handling
- Stored as `Invoice` and `Bill` records.
- Associated with `Customer` and `Vendor`.
- Handled via `api/ingest/ar` and `api/upload/ap` routes.

## 8. Existing Recurring Commitment Handling
- Stored in `RecurringCommitment`.
- Adjusted/rescheduled via `api/recurring-reschedule`.

## 9. Existing Cash In/Out or Manual Cash Movement Handling
- Managed via `CashFlowCategory` and `CashFlowEntry`.
- Captured via `api/cash-entries` and `api/cash-adjustments`.

## 10. Existing Action/Recommendation Logic
- Powered by `ActionItem` model.
- Includes actions like `collect_ar`, `delay_ap`, `reduce_outflows`, `risk_alert`.
- Interacted with via `api/triage`.

## 11. Existing Simulation/What-If Logic
- Managed via `ScenarioItem` model (in/out scenarios).
- API routes at `api/scenarios`.

## 12. Existing Audit/Override/Change Log Logic
- Captured in `ChangeLog` and `Override` models.
- API endpoints at `api/audit` and `api/overrides`.

## 13. Existing Auth/Multi-Tenant Logic
- Powered by Clerk Organizations.
- `src/lib/tenant.ts` resolves the `companyId` based on the active Clerk organization.

## 14. Known Architecture Gaps
- The action engine and simulation loops are emerging but lack full automated feedback loops (Verify step).
- Complex integrations (e.g., direct QuickBooks sync) are deferred.

## 15. Near-Term Technical Priorities
- Stabilize the basic action loop (Data → Forecast → Explain → Decide).
- Implement the "Verify" loop to build trust.
- Ensure the Dashboard remains the single source of truth for the AR/AP ledger calculations.
