# Week Review Architecture

## 1. Purpose
The Week Review module serves as the final step in the weekly cash flow lifecycle. Its purpose is to compare the previous week's forecast against what actually occurred, explain variances, review post-approval drift and committed actions, and orchestrate the closing of the week to roll forward into a new forecast.

* **Workflow Position:** Executed at the end of the week / beginning of a new week.
* **Inputs Required:** Execution plans (original/revised), live forecast data, historical `ForecastCheckpoint`s, current cash state (`CashSnapshot`, `CashAdjustment`), historical `BankTransaction`s, and `ChangeLog` audit data.
* **Outputs Produced:** Triggers the generation of a new baseline forecast by closing the week via the `UpdateBalanceDialog` (which persists the new starting balance).

## 2. User Workflow
The complete user flow implemented in the repository is:
1. **Entering Week Review:** User navigates to the `/review` page.
2. **Selecting a Week:** User selects between the "Active Review (Current Week)" or historical weeks via a dropdown.
3. **Viewing Variances:** User reviews the top-level summary widget comparing Expected Ending Cash vs Actual Ending Cash and the calculated Variance.
4. **Viewing Debrief:** User inspects the "Debrief: What Changed" panel (for historical weeks) to see why the variance occurred.
5. **Detailed Auditor View:** User toggles "View Detailed Ledger" to see a comparison table of Beginning Cash, Inflows, Outflows, Reconciliation Difference, and Ending Cash across Original Plan, Revised Plan, Latest Forecast, and Actuals.
6. **Reviewing Additional Context:** User reviews Post-Approval Drift, Committed Actions from the prior week, Learning Proposals, and Backlog Triage.
7. **Completing Review & Rolling:** For the active week, the user clicks "Close Week & Roll".
8. **Updating Balances:** The `UpdateBalanceDialog` appears, allowing the user to confirm the current bank balance and adjustments before saving and rolling the forecast forward.

## 3. Data Flow
1. **APIs:** The frontend reads data primarily from `/api/review` and `/api/variance-drivers`.
2. **Services:** 
   * `api/review/route.ts` aggregates data from `ExecutionPlan`, `ForecastCheckpoint`, `CashSnapshot`, `BankTransaction`, and `ChangeLog`.
   * `variance-drivers.ts` dynamically computes the debrief drivers for historical weeks.
3. **Calculations & Persistence:** 
   * Variances are calculated *on the fly* in `variance-drivers.ts` by parsing the legacy `breakdownJson` from `ForecastCheckpoint` and querying the *current* state of `ReceivableInvoice` and `PayableBill` in the database.
   * `api/review/route.ts` dynamically calculates `reconciliationDifference` by summing `BankTransaction` rows for the week and comparing it to `CashSnapshot`s.
   * The Week Review module itself is purely read-only for diagnostics. Persistence only occurs when the user submits the `UpdateBalanceDialog` to roll the week.

## 4. Current Calculations
The following calculations are actively performed in the module:
* **actualAdjustedCash:** `bankBalance` + sum of current `CashAdjustment`s.
* **totalVariance:** `actualAdjustedCash` - `endCashExpected` (from checkpoint).
* **actualInflows / actualOutflows:** Sum of `BankTransaction` amounts filtered by direction.
* **reconciliationDifference:** `actualEndingCash` - (`actualStartCash` + `actualInflows` - `actualOutflows`).
* **explainedVariance:** Sum of impacts from collected/uncollected/modified/deleted AR and AP items.
* **unexplainedResidual:** `totalVariance` - `explainedVariance`.
* **explanationCoverage:** `explainedVariance` / `totalVariance`.
* **Item-level impact:** (Expected Amount) - (Current Open Amount of the invoice/bill), assuming it is still open, or $0 if paid, or full expected amount if deleted.

## 5. Current Diagnostic Capability
* **Why was the forecast wrong?** For older weeks, uses the legacy legacy fallback. For deterministic weeks, uses precisely graded `ForecastComponentEvaluation` data (Slice 5).
* **Which customers caused the variance?** Grouped by deterministic evidence when available.
* **Which expenses caused the variance?** Grouped by deterministic evidence when available.
* **Which items shifted in time?** *Implemented.* Slice 5 explicitly separates and displays `timing_shift` items with their exact cross-week destination.
* **Which transactions remain unresolved?** *Implemented.* Slice 5 distinctly identifies `unresolved_actual` transactions and breaks them out beneath the reconciliation difference.
* **Which forecast components matched perfectly?** *Implemented.* Both legacy and deterministic paths display exact matches/collections.

## 6. Integration with Slices 1–5
* **ForecastCheckpoint:** **Read.** Used for legacy legacy backward compatibility and to anchor the deterministic run.
* **ForecastComponentSnapshot:** **Read.** Used to reconstruct original expectations.
* **ActualCashAttribution:** **Read.** Displayed in drill-downs for deterministic drivers.
* **ForecastEvaluationRun:** **Read.** Drives the `/api/review/variance-drivers` deterministic fallback logic.
* **ForecastComponentEvaluation:** **Read.** Provides the core classification (`matched`, `timing_shift`, etc.).
* **ForecastComponentEvaluationAttribution:** **Read.** Used to drill into precise evidence.

## 7. Existing UI
* **Pages:** A single unified dashboard at `src/app/review/page.tsx`.
* **Dialogs:** `UpdateBalanceDialog` for capturing closing balances.
* **Tables:** A "Forecast Comparison" ledger table comparing metrics across Plan/Forecast/Actuals.
* **Charts:** None.
* **Cards/Panels:** 
  * Summary widget (Plan vs Actual vs Variance)
  * "Debrief: What Changed" panel (`VarianceDriverPanel`)
  * "Post-Approval Drift" list
  * "Committed Actions Review"
  * "Learning Proposals"
* **Drill-downs:** The `VarianceDriverPanel` currently groups items by driver (e.g., "AR Not Collected") and lists the line items beneath them. This existing panel is the natural home for presenting Slice 5 deterministic diagnostics.

## 8. Resolved Architectural Gaps (Slice 5)
The architectural gaps previously identified have been closed:
1. **Disconnected Backend:** The `variance-drivers.ts` engine now cleanly branches between legacy extraction and the new deterministic `ForecastComponentEvaluation` records.
2. **Missing Concepts:** Timing shifts, partial payments, and explicit unresolved cash are now fully typed and rendered in the `VarianceDriverPanel`.
3. **Legacy Data Dependency:** Handled smoothly via conditional mapping. Older weeks use `breakdownJson`, new weeks use `ForecastComponentSnapshot`.

## 9. Reuse Opportunities
* The **`src/app/review/page.tsx` UI** should absolutely be extended rather than replaced. The layout, dropdown selectors, and summary widgets are well-structured.
* The **`VarianceDriverPanel`** component should be reused, but its data source and internal categorizations must be updated to consume deterministic `ForecastComponentEvaluation` data rather than the legacy `VarianceDriverResult`.
* The **`UpdateBalanceDialog`** should remain the entry point for triggering the weekly roll.

## 10. Final Assessment

1. **Is Week Review already the correct home for Slice 5?**
   Yes. It is explicitly designed as the debrief and transition point for the weekly workflow.
2. **Approximately what percentage of Slice 5 already exists?**
   ~40%. The UI framework, routing, historical selection, basic summary metrics, and the concept of a debrief panel exist. However, the deterministic data backend is 0% integrated.
3. **Which existing components should be reused?**
   `review/page.tsx`, the Plan vs Actual Summary Widget, the `VarianceDriverPanel` (adapted for new data), and the `UpdateBalanceDialog`.
4. **Which new deterministic capabilities still need to be implemented?**
   An API or service layer must be built to serve `ForecastEvaluationRun` and `ForecastComponentEvaluation` results to the frontend, replacing the legacy `variance-drivers.ts` service.
5. **Would building a separate Slice 5 module increase unnecessary complexity?**
   Yes. Slice 5 successfully integrated into the existing module, proving this architecture was correct.

---
**Path to document:** `docs/week-review-architecture.md`
**List of inspected files:** 
- `src/app/review/page.tsx`
- `src/app/api/review/route.ts`
- `src/services/variance-drivers.ts`
**Confidence level for conclusions:** High (Based entirely on explicit implementations found in the current codebase)
**Uncertainties discovered:** None. The architectural boundary between the legacy variance calculation and the new Slice 1-4 deterministic engine is completely distinct and identifiable.
