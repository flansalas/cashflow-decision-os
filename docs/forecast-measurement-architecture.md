# Forecast Measurement Architecture

## 1. Purpose and Architectural Boundary

The existing forecasting engine remains in place and was **not replaced**. 

The work completed through Slices 1–4 added a non-destructive measurement and diagnostic infrastructure around the existing forecast engine. The purpose of this architecture is to preserve historical context and evaluate deterministic accuracy. Specifically, the system now preserves:

* **What was forecast:** Saving the exact, post-override expectations.
* **What actually occurred:** Recording verified bank activity in real-time.
* **How actual cash was attributed:** Linking actual bank transactions to the economic records that caused them.
* **How forecast components were evaluated:** Comparing the expected snapshot against the actual attributions.
* **Which confirmed deterministic defects were repaired:** Enforcing rigorous matching and classification rules to prevent false variance.

**Architectural Boundaries:**
- **Existing forecast generation:** The original engine remains responsible for computing future expectations.
- **Forecast measurement:** The new layer (Slices 1–4) that records expectations and attributes actuals.
- **Actual cash attribution:** Links resolved payments to their source components.
- **Evaluation:** The engine that diffs expectations against attributions to calculate statuses (e.g., missed, unexpected, timing shift).
- **Owner-facing explanation:** Slice 5 implements the deterministic presentation of this data without disrupting legacy workflows.

---

## 2. Slice-by-Slice Implementation Record

### Slice 1 — Forecast Component Snapshots
* **Objective:** Preserve the committed, post-override forecast for future measurement.
* **Models:** `ForecastCheckpoint`, `ForecastComponentSnapshot`
* **Services / Functions:** The check-in API (`src/app/api/cash-checkin/route.ts`) captures the forecast output.
* **Migrations:** `20260724183000_init_forecast_snapshots`
* **Tests:** `test-checkin.ts`
* **Deterministic Rules:** Snapshots reflect the fully computed, post-override forecast breakdown by storing every individual component that contributes to inflow and outflow totals.
* **Verification Evidence:**
  - Snapshot completeness and post-override capture are verified through direct inspection of the check-in route and forecast breakdown logic.
  - The behavior is exercised by the route test (`test-checkin.ts`), which logs the result.
  - *Note:* It is not currently protected by a strict throwing automated assertion for every forecast component type.
* **Final Approval Status:** Approved.

### Slice 2 — Actual Cash Attribution
* **Objective:** Confidently link bank transactions to expected economic records (invoices, bills, patterns).
* **Models:** `ActualCashAttribution`
* **Services / Functions:** `src/services/attribution.ts` (`attributeTransaction`, `resolveOutstandingAttributions`)
* **Migrations:** `20260723190000_slice_2_actual_cash_attribution`
* **Tests:** `test-attribution.ts`
* **Deterministic Rules:**
  - Attribution categories are explicitly defined (e.g., `scheduled_ar`, `scheduled_ap`, `recurring`, `unresolved_inflow`, `unresolved_outflow`).
  - Strict logic prevents matching by amount alone (amount-only matching without stable identity is rejected).
  - Handles partial and multiple payments against a single source record.
  - Attributions are versioned using `attributionRunId` and `version` to preserve replacement history without destructing user-verified records.
* **Final Approval Status:** Approved.

### Slice 3 — Forecast Evaluation
* **Objective:** Compare component snapshots to actual cash attributions to grade forecast accuracy.
* **Models:** `ForecastEvaluationRun`, `ForecastComponentEvaluation`, `ForecastComponentEvaluationAttribution`
* **Services / Functions:** `src/services/evaluation.ts` (`runEvaluationForWeek`, `evaluateForecasts`)
* **Migrations:** `20260724190000_slice_3_forecast_evaluation`
* **Tests:** `test-evaluation.ts`
* **Deterministic Rules:**
  - Evaluation runs are versioned (`version`, `isActive` flag) allowing historical reconstruction.
  - Many-to-many junction (`ForecastComponentEvaluationAttribution`) links components to evidence.
  - Uses integer-cent conversions (`Math.round(val * 100)`) to prevent floating-point drift during evaluation.
  - Generates discrete component statuses (`matched`, `partial`, `missed`, `timing_shift`, `unexpected_actual`, `unresolved_actual`).
* **Final Approval Status:** Approved.

### Slice 4 — Deterministic Defect Repairs
* **Objective:** Resolve edge cases causing false variance, notably around COGS classification, recurring identities, cross-week timing shifts, and migration integrity.
* **Services / Functions:** `src/services/forecast.ts`, `src/services/detectPatterns.ts`, `src/services/evaluation.ts`
* **Migrations:** `20260725000000_slice_4_cogs_classification_fix`, `20260725113632_slice_4_timing_evidence`. Baseline script `scripts/init-baselined-clean-db.sh`.
* **Tests:** `test-slice-4-cogs.ts`, `test-slice-4-fixes.ts`, `test-evaluation.ts`
* **Deterministic Rules:**
  - **COGS and AP classification:** `expenseClass` is stored at the bill level (`PayableBill.expenseClass`).
  - **Vendor defaults:** `VendorProfile.defaultExpenseClass` pre-populates new bills, but existing `unknown` bills do *not* dynamically inherit the vendor classification at forecast time.
  - **Unknown/Mixed:** Mixed expenses are treated as `unknown` and do not offset the COGS floor. Only explicitly confirmed `cogs` bills reduce the COGS floor.
  - **Recurring identity matching:** Amount alone is insufficient. Must match `merchantKey`, `direction`, and fall within a valid `cadence` window relative to the `nextExpectedDate`.
  - **Cross-week timing shifts:** The evaluation engine links out-of-week attributions using `evidenceRole: "timing_evidence"`. It records `actualDate`, `daysShifted`, and `shiftDirection` on the component evaluation.
  - **Unexpected-actual suppression:** If a transaction landed this week but was already explained by an active timing-shift evaluation from another week, it remains in the actual totals but is suppressed from being incorrectly duplicated as an `unexpected_actual`.
  - **Migration integrity:** Historical migrations were preserved immutably. A guarded baseline script was introduced to handle clean environments.
* **Final Approval Status:** Approved.

### Slice 5 — Deterministic Week Review Integration
* **Objective:** Connect the persisted deterministic measurement infrastructure (Slices 1–4) to the existing owner-facing Week Review page.
* **Services / Functions:** `src/services/deterministic-variance.ts`, `src/app/api/review/variance-drivers/route.ts`
* **UI Components:** `src/components/VarianceDriverPanel.tsx`
* **Tests:** `test/services/deterministic-variance.test.ts`, `test/api/variance-drivers.test.ts`
* **Deterministic Rules:**
  - Separates the transaction-based deterministic forecast variance from the balance-based ending cash reconciliation difference.
  - Recursively fetches and groups timing-shift, partial-payment, and unresolved cash evidence.
  - Binds the new deterministic `/api/review/variance-drivers` endpoint seamlessly into the legacy `/review` page.
  - Automatically falls back to the legacy historical breakdown for older weeks lacking an active evaluation run.
* **Post-Implementation Repairs:** Addressed sign-convention errors to correctly handle negative-outflow math and migrated `ActualCashAttribution` to a soft-deletion versioned lifecycle to preserve immutable historical evaluation evidence.
* **Final Approval Status:** Completed.

---

## 3. Current Data Model

### Map of Relevant Models

* **`ForecastCheckpoint`**
  - **Responsibility:** Anchors a forecast run for a specific week, storing total expectations and linking to the source cash snapshot.
  - **Identifiers:** `id`, `cashSnapshotId`, `forecastVersionHash`
* **`ForecastComponentSnapshot`**
  - **Responsibility:** Records an individual expected inflow or outflow item (e.g., a specific bill or baseline bucket) exactly as it was forecast.
  - **Identifiers:** `id`, `forecastCheckpointId`, `sourceId`, `sourceType`
* **`ActualCashAttribution`**
  - **Responsibility:** Links a real bank transaction to an economic source record (like an invoice or recurring pattern), indicating how much cash was resolved.
  - **Identifiers:** `id`, `bankTransactionId`, `sourceId`, `attributionRunId`
* **`ForecastEvaluationRun`**
  - **Responsibility:** Groups the evaluation results for a specific week and checkpoint. Uses `version` and `isActive` to allow non-destructive recalculations.
  - **Identifiers:** `id`, `checkpointId`, `weekStart`
* **`ForecastComponentEvaluation`**
  - **Responsibility:** Represents the graded result (e.g., missed, matched, timing_shift) of a single forecast component snapshot against actuals.
  - **Identifiers:** `id`, `evaluationRunId`, `snapshotId`
* **`ForecastComponentEvaluationAttribution`**
  - **Responsibility:** The many-to-many junction that explains *why* a component received its status, linking to the actual cash attributions that provide the evidence.
  - **Identifiers:** `id`, `componentEvaluationId`, `actualCashAttributionId`, `evidenceRole`
* **`BankTransaction`**
  - **Responsibility:** Represents raw, verified cash movement from the bank.
  - **Identifiers:** `id`, `txHash`
* **`PayableBill`**
  - **Responsibility:** An accounts payable record, now holding its own explicit `expenseClass`.
  - **Identifiers:** `id`, `billNo`
* **`VendorProfile`**
  - **Responsibility:** Represents the supplier entity, providing a `defaultExpenseClass` for new bills.
  - **Identifiers:** `id`, `vendorName`
* **`RecurringPattern`**
  - **Responsibility:** A heuristically discovered or manually defined pattern of regular cash flow.
  - **Identifiers:** `id`, `merchantKey`

---

## 4. End-to-End Deterministic Flow

Trace of a cross-week timing shift:

1. **Forecast committed:** A Week 1 forecast is committed, anticipating a $1,000 AP payment to Vendor A.
2. **Snapshot taken:** A `ForecastComponentSnapshot` is saved representing this $1,000 outflow expectation for Week 1.
3. **Transaction occurs late:** The actual bank payment of $1,000 clears the bank on Tuesday of Week 2.
4. **Transaction attributed:** The system creates an `ActualCashAttribution` linking the Week 2 `BankTransaction` to Vendor A’s `PayableBill`.
5. **Evaluation compares expected/actual:** The `ForecastEvaluationRun` for Week 1 sees 0 actual cash applied during Week 1 for that bill.
6. **Timing shift classified:** The evaluation searches adjacent weeks, finds the Week 2 attribution, and marks the Week 1 `ForecastComponentEvaluation` status as `timing_shift` with `shiftDirection: "late"`.
7. **Zero current-week actual:** Week 1 records $0 current-week actual cash for that component, keeping its actual totals strictly bounded by date.
8. **Week 2 retains cash:** The $1,000 cash correctly remains in Week 2’s actual aggregate totals.
9. **Unexpected actual suppressed:** Week 2's evaluation run checks for active `timing_evidence` links. It sees the cash is already explained by Week 1's evaluation, so it suppresses the creation of an `unexpected_actual` component.
10. **Historical integrity:** If re-evaluated, the old evaluation run is marked `isActive: false` and a new version is created, ensuring historical evaluation versions remain reconstructable.

---

## 5. Invariants and Non-Negotiable Rules

* Historical forecast snapshots are immutable.
* Amount alone does not establish recurring identity.
* Unresolved cash is not baseline (baseline variance requires a distinct calculation).
* Existing `unknown` bills do *not* inherit a vendor classification during forecasting.
* Only explicitly confirmed `cogs` AP offsets the COGS floor.
* Inactive evaluation versions do not control current classification or evidence logic.
* Timing evidence does not enter the expected week’s actual total (cash boundaries are strictly maintained).
* Actual cash remains counted in the aggregate totals of the week it actually occurred.
* Previously applied migration files are not rewritten.
* Normal deployment must use `npx prisma migrate deploy` and does not execute the clean-database baseline process.

---

## 6. Test Inventory and Evidence

* **`test-attribution.ts`**
  - **Proves:** Actual cash attribution logic, handling exact matches, unresolved remainders, and idempotency across re-runs.
  - **Method:** Service-level deterministic test. Assertions throw hard failures.
* **`test-evaluation.ts`**
  - **Proves:** Forecast evaluation logic, component statuses, versioning, integer-cent safety, cross-week timing shifts, and unexpected-actual suppression. Asserts 7 distinct evaluation conditions.
  - **Method:** Service-level deterministic test. Assertions throw hard failures.
* **`test-slice-4-cogs.ts`**
  - **Proves:** `unknown` bills do not offset the baseline COGS floor, whereas explicitly `cogs` classified bills correctly offset the projected COGS requirement.
  - **Method:** Service-level deterministic test. Assertions throw hard failures.
* **`test-slice-4-fixes.ts`**
  - **Proves:** Recurring identity logic correctly rejects amount-only collisions, mismatched directions, and transactions falling outside the strict cadence window.
  - **Method:** Service-level deterministic test. Assertions throw hard failures.
* **`test-checkin.ts`**
  - **Proves:** API route correctly parses frontend forecast expectations and successfully initializes `ForecastCheckpoint` and `ForecastComponentSnapshot` records.
  - **Method:** API Route test against local endpoint. Logs results (does not strictly throw).
* **`test-variance.ts`**
  - **Proves:** Macro-level variance ledger updates correctly sync based on bank balances.
  - **Method:** Service-level test. Logs results.

*(Note: There is no evidence of UI-layer testing for Slices 1–4 inside this repository at this time.)*

---

## 7. Migration History

* **The Ghost Migration Issue:** 
  1. Was `20260701200739_add_execution_plan` recorded as applied in Neon historically? **No.** The migration was a committed-but-unapplied ghost migration that was skipped in the remote environment.
  2. Did its SQL execute in Neon? **No.**
  3. Which migration created the actual Neon `ExecutionPlan` schema? **`20260709011700_add_execution_plan_fields`** executed the `CREATE TABLE` statements in Neon.
  4. Was any previously applied migration file rewritten? **No.** No historically applied migrations were altered. The conflict stemmed purely from the presence of the unapplied ghost migration in the git history.
  5. Why is `migrate resolve --applied` valid only for a verified blank-database baseline? Because running `resolve` blindly on a populated database bypasses Prisma's integrity checks. The clean-database baseline script safely marks the ghost migration as resolved *only* if the database is strictly empty, allowing the subsequent `20260709011700` migration to safely build the tables without Prisma attempting to apply the ghost migration first.
* **Intentionally Baselined Migration:** `20260701200739_add_execution_plan` was restored to its exact git-committed state to maintain immutability.
* **Clean-Database Baseline Script:** `scripts/init-baselined-clean-db.sh` exists to initialize brand new environments by baselining the ghost migration.
* **Normal Deployments:** Future migrations to existing environments strictly use `npx prisma migrate deploy`.
* **Introduced Migrations (Slices 1–4):**
  - `20260723190000_slice_2_actual_cash_attribution`
  - `20260724183000_init_forecast_snapshots`
  - `20260724190000_slice_3_forecast_evaluation`
  - `20260725000000_slice_4_cogs_classification_fix`
  - `20260725113632_slice_4_timing_evidence`

---

## 8. Known Limitations and Unfinished Work

* **Diagnostic Ranking (Learning/Proposal Layer):** The logic to deeply learn from these drivers and propose permanent automated fixes remains unbuilt.
* **Mixed Expense Allocation:** Bills containing both OPEX and COGS are treated as `unknown` and do not offset the COGS floor. Mixed-allocation support is intentionally unbuilt.
* **Merchant Identity:** The system still heavily relies on strict string matching or previously linked explicit merchant setups (`merchantKey`).

---

## 9. Next Architectural Boundary

With Slices 1–5 complete, the deterministic baseline, measurement, and presentation tiers are fully implemented. 

The next boundary involves **learning and proposing structural changes** based on the deterministic evidence.

**Explicitly Excluded from Slices 1-5:**
* AI integrations or natural language chat logic.
* Replacing or discarding the core forecasting model.
* Automatic learning or automatic modification of payment curves.
* Automatic baseline adjustments based on the new measurements.
* Broad redesigns of the underlying forecasting engine.

---

## 10. Repository Evidence Appendix

| Artifact / Behavior | Source File | Relevant Entity / Method | Verification Method |
| :--- | :--- | :--- | :--- |
| Forecast Snapshots | `prisma/schema.prisma` | `ForecastComponentSnapshot` | Direct inspection |
| Snapshot Preservation | `src/app/api/cash-checkin/route.ts` | `POST` | Direct inspection / `test-checkin.ts` |
| Attribution Strictness | `src/services/attribution.ts` | `attributeTransaction` | `test-attribution.ts` |
| Evaluation Math/Types | `src/services/evaluation.ts` | `runEvaluationForWeek` | `test-evaluation.ts` |
| COGS/AP Masking | `src/services/forecast.ts` | `computeForecast` | `test-slice-4-cogs.ts` |
| Timing Evidence Links | `src/services/evaluation.ts` | `findTimingEvidence` | `test-evaluation.ts` |
| Recurring Windows | `src/services/detectPatterns.ts` | `isRecurringIdentityMatch` | `test-slice-4-fixes.ts` |
| Immutable Migrations | `prisma/migrations/` | Directory contents | Direct inspection |
| Baseline Script | `scripts/init-baselined-clean-db.sh` | Bash script logic | Direct inspection |
