# Slice 5 — Deterministic Week Review Integration

## 1. Current-to-target architecture

**Current flow:**
The frontend `/review` page calls `/api/variance-drivers` (either by `?checkpointId=...` or `?latest=true`). 
This API routes to `computeVarianceDrivers` in `src/services/variance-drivers.ts`.
The service reads the legacy `breakdownJson` from the `ForecastCheckpoint`, queries current `ReceivableInvoice` and `PayableBill` tables for their *present* state (`amountOpen`, `status`), and reconstructs an approximate variance explanation.

**Proposed target flow:**
The frontend `/review` page will still call `/api/variance-drivers`.
The API will first check if an active `ForecastEvaluationRun` exists for the requested `checkpointId`.
- **If deterministic evaluation exists:** The API will query the persisted `ForecastComponentEvaluation` and `ForecastComponentEvaluationAttribution` records. It will return a deterministic response structured for the new UI categories.
- **If deterministic evaluation does not exist (legacy week):** The API will fall back to the existing `computeVarianceDrivers` logic but flag the response as `isLegacy = true`.

**Impacts:**
- **Modified Endpoints:** `/api/variance-drivers` is adapted to branch between deterministic and legacy data. No new endpoint is necessary.
- **Service layer:** `variance-drivers.ts` will be retained strictly for legacy fallback. A new service function (e.g., `getDeterministicVarianceDrivers`) will be introduced to handle Slice 1–4 evaluation records.
- **Unchanged UI:** Weekly selection, Expected-vs-Actual summary widget, Detailed Ledger, Post-Approval Drift, Committed Actions, Learning Proposals, Backlog Triage, UpdateBalanceDialog, and Close Week & Roll workflow.
- **Adapted UI:** `VarianceDriverPanel` requires controlled adaptation to consume the deterministic categories (Timing shifts, Unresolved cash, etc.) and expose the new drill-down evidence payload.

## 2. Evaluation-run selection

- **Mapping week to Checkpoint:** The Week Review UI already identifies the correct `ForecastCheckpoint` via `checkpointId`.
- **Active Evaluation Selection:** The API will select the specific `ForecastEvaluationRun` where `checkpointId = targetCheckpointId` and `isActive = true`.
- **Multiple Versions:** If multiple versions exist (due to re-evaluations), only the one marked `isActive = true` is loaded. Inactive runs are ignored because they represent historical debug states or superseded logic.
- **Missing Evaluation:** If no evaluation run exists, the API will read the legacy `breakdownJson` and provide the legacy explanation. 
- **Triggering Evaluation:** Week Review **will not** trigger or compute an evaluation. It strictly reads persisted records. Generation of evaluations remains a background/cron or separate API concern.

## 3. Mathematical reconciliation

The deterministic evaluation is based on forecast component expectations versus attributed actual bank transactions. These will differ from the top-level ending cash variance whenever imported bank transactions do not fully reconcile to the entered closing balance.

Therefore, we do not require the sum of component driver impacts to equal the balance-based top-level variance, unless the cash-reconciliation difference is zero.

Instead, the mathematical reconciliation follows this strict separation:

**1. Transaction-based forecast variance:**
`transaction-based forecast variance = sum of deterministic component impacts`

**2. Balance-based ending-cash variance:**
`balance-based ending-cash variance = transaction-based forecast variance + cash-reconciliation difference`

The API and UI must keep these values distinct. Do not absorb the reconciliation difference into unresolved actual cash, unexpected actual cash, unexplained forecast variance, or any component driver.

**Sign Convention (Impact on Expected Ending Cash):**
- **Inflow received above forecast:** Positive (+)
- **Inflow received below forecast (partial):** Negative (-)
- **Outflow above forecast (spent more):** Negative (-)
- **Outflow below forecast (spent less):** Positive (+)
- **Missed inflow:** Negative (-)
- **Missed outflow:** Positive (+)
- **Timing shifts:**
  - Late inflow: Negative (-) in expected week.
  - Late outflow: Positive (+) in expected week.
  - Early inflow: Positive (+) in actual week.
  - Early outflow: Negative (-) in actual week.
- **Unexpected actual inflow:** Positive (+)
- **Unexpected actual outflow:** Negative (-)
- **Unresolved actual inflow:** Positive (+)
- **Unresolved actual outflow:** Negative (-)

The API will enforce a mathematical invariant check before returning the response. It will verify that the sum of the component driver impacts exactly equals the `transaction-based forecast variance`. It will also verify that the `balance-based ending-cash variance` exactly equals the `transaction-based forecast variance` plus the `cash-reconciliation difference`. Discrepancies will be explicitly classified as a system reconciliation error.

## 4. Timing-shift presentation

Timing shifts will be distinctly grouped. Instead of presenting a late payment as "Missed", it will be displayed as a "Timing Shift".

For each timing shift, the UI will present:
- **Original Forecast Component:** (e.g., "Invoice INV-100 from Acme Corp")
- **Expected Date:** The originally forecasted payment date.
- **Actual Date:** The date the cash actually cleared the bank.
- **Signed Days Shifted & Early/Late label:** (e.g., "4 days late" or "2 days early").
- **Expected Amount:** The forecast component amount.
- **Attributed Evidence Amount:** The exact cash amount linked to this shift.
- **Impact on Reviewed Week:** (e.g., -$1,000 variance because the inflow missed the week boundary).
- **Source Week & Actual Cash Week:** Identifies which week the cash actually belongs to.

*Crucially*, the panel will not display timing evidence as though the cash occurred in the expected week. It will explicitly show that the cash settled in a different week, causing the variance in the reviewed week.

## 5. Driver categories

The `VarianceDriverPanel` will be updated to map deterministic evaluation statuses into these stable groups:

- **Timing Shifts:** Components with status `timing_shift`.
- **Amount Differences:** Components with status `partial`.
- **Missed Forecast Items:** Components with status `missed`.
- **Unexpected Actual Cash:** Components with status `unexpected_actual`.
- **Unresolved Actual Cash:** Components with status `unresolved_actual`.
- **Matched Items:** Components with status `matched`.

*Note: Matched items will be available at the bottom of the panel (or under a toggle) to prevent crowding out the meaningful variance drivers. We will rely on actual `sourceId` / `sourceType` for identity, avoiding brittle display-name inference.*

## 6. Ranking

Drivers will be ranked at the **component evaluation** level, not at the grouped driver level.
- **Primary Sort:** Absolute variance impact (descending). A -$10,000 impact is equally as important as a +$10,000 impact.
- **Tie Breaker 1:** Expected Amount (descending).
- **Tie Breaker 2:** `sourceId` (alphabetical/deterministic).
- **Zero-impact Items:** Placed at the bottom or hidden by default.
- **Multiple Attributions:** Aggregated at the component level (one drill-down row per component, with multiple attribution lines inside).
- **Timing Shifts:** Ranked by their variance impact on the *reviewed week*, not by their total attributed amount (which may have zero variance impact in a different week).

## 7. Drill-down evidence

The drill-down payload will only expose necessary, owner-facing fields. No raw internal JSON will be leaked.

**Drill-down Payload Structure:**
- `status`: String (matched, partial, missed, timing_shift, unexpected, unresolved)
- `sourceType`: String
- `sourceId`: String
- `displayLabel`: String (e.g., Customer or Vendor Name, if available)
- `expectedAmount`: Float (in cents, converted for display)
- `actualAmount`: Float
- `varianceImpact`: Float
- `expectedDate`: ISO Date String
- `actualDate`: ISO Date String (if applicable)
- `timing`: `{ daysShifted: Int, shiftDirection: "early" | "late" }`
- `evidenceRole`: String
- `evaluationVersion`: Int
- `linkedAttributions`: Array of `{ bankTransactionId, amountApplied, confidenceTier, txDate, description }`

## 8. Cash reconciliation boundary

Cash reconciliation will remain strictly independent of the deterministic forecast explanation.

- **Unexplained forecast variance:** Will be zero if the evaluation engine has 100% coverage.
- **Unresolved attribution:** Bank transactions that have not been assigned to a forecast component. These sum to explain part of the forecast variance.
- **Bank reconciliation difference:** (`actualEndingCash` - (`startCash` + `actualInflows` - `actualOutflows`)). This represents missing bank data or unbalanced cash snapshots.

The UI will preserve the top-level "Detailed Ledger" and clearly separate the `Bank Reconciliation Difference` from the `Variance Drivers` list. They are mathematically distinct and will not be conflated.

## 9. Legacy-data handling

For historical weeks created before Slices 1–4:
- The API will detect the absence of an active `ForecastEvaluationRun`.
- It will invoke the existing `variance-drivers.ts` logic using `breakdownJson`.
- The frontend will detect `isLegacy: true` in the API response.
- The UI will render a clear warning badge: "Legacy Explanation: This week predates deterministic tracking and is based on inferred current states."
- `breakdownJson` must remain temporarily until all historical checkpoints have an evaluation run backfilled, or until legacy support is officially dropped.

## 10. API contract

**Endpoint:** `GET /api/variance-drivers?checkpointId=<uuid>`

**Response Shape:**
```json
{
  "isDeterministic": true,
  "evaluationVersion": 1,
  "totals": {
    "balanceBasedEndingCashVariance": -500.00,
    "transactionBasedForecastVariance": -500.00,
    "cashReconciliationDifference": 0.00,
    "deterministicExplainedVariance": -400.00,
    "deterministicUnresolvedVariance": -100.00
  },
  "cashReconciliation": {
    "startCash": 10000.00,
    "inflows": 5000.00,
    "outflows": -2000.00,
    "expectedEndingCash": 13000.00,
    "actualEndingCash": 13000.00,
    "reconciliationDifference": 0.00
  },
  "groups": [
    {
      "category": "Timing Shifts",
      "items": [
        {
          "id": "eval-uuid",
          "status": "timing_shift",
          "sourceType": "receivable_invoice",
          "displayLabel": "Acme Corp (INV-100)",
          "expectedAmount": 500.00,
          "actualAmount": 0.00,
          "varianceImpact": -500.00,
          "expectedDate": "2026-07-20",
          "timing": { "daysShifted": 4, "shiftDirection": "late", "actualDate": "2026-07-24" },
          "evidenceRole": "current_week_actual",
          "linkedAttributions": [
             {
               "bankTransactionId": "tx-123",
               "amountApplied": 500.00,
               "confidenceTier": "high",
               "txDate": "2026-07-24",
               "description": "WIRE FROM ACME"
             }
          ]
        }
      ]
    }
  ]
}
```

## 11. UI reuse and minimum changes

- **`review/page.tsx`:** No broad changes. Summary widget and detailed ledger remain untouched (they read top-level cash snapshot data).
- **`VarianceDriverPanel.tsx`:** Adapted to accept the new API contract (`isDeterministic`, `groups`). It will render the legacy view if `isDeterministic` is false.
- **Drill-down Rows:** New render logic within the panel to display `linkedAttributions` and the `timing` badge (e.g., `<Badge variant="warning">4 days late</Badge>`).
- **No new pages, charts, or unnecessary redesigns.**

## 12. Tests

The following strict automated tests will be added:

**Service Tests (`test/services/deterministic-variance.test.ts`):**
1. Strict invariant test: when bank transactions do not reconcile to the closing balance, deterministic component impacts still reconcile to the transaction-based forecast variance; the reconciliation difference remains separate; and the balance-based ending-cash variance equals both layers combined.
2. Late customer inflow (- impact on reviewed week).
3. Late vendor outflow (+ impact on reviewed week).
4. Partial payment from multiple attributions.
5. Unexpected inflow (+ impact).
6. Unexpected outflow (- impact).
7. Unresolved inflow and outflow (+/- impact).
8. Matched items produce zero variance.
9. Active evaluation version is selected over inactive versions.
10. Week with no evaluation returns an explicit unavailable/legacy state.

**API Tests (`test/api/variance-drivers.test.ts`):**
11. API response totals exactly match persisted evaluation records.
12. Legacy week returns `isDeterministic: false`.

**UI Component Tests (React Testing Library):**
13. Cash reconciliation difference remains visually separate from unexplained forecast variance.
14. Existing Close Week & Roll behavior is unaffected by driver payload changes.

## 13. Migration and persistence assessment

**Migration Requirement: NO.**
The Prisma schema for `ForecastEvaluationRun`, `ForecastComponentEvaluation`, and `ForecastComponentEvaluationAttribution` already contains all necessary fields (`status`, `daysShifted`, `shiftDirection`, `evidenceRole`, `confidenceTier`). We do not need a new persistence model for Week Review explanations; the evaluation output is precisely designed to be the read model.

## 14. Legacy retirement plan

- `computeVarianceDrivers` in `src/services/variance-drivers.ts` will become obsolete for deterministic weeks.
- The service will be retained strictly to support historical checkpoints lacking evaluation runs.
- `/api/variance-drivers` will be retained and enhanced (not deleted), as it is the stable contract consumed by `review/page.tsx`, `WeeklyRoutineCard.tsx`, and `UpdateBalanceDialog.tsx`.
- Once a backfill script processes all historical checkpoints, `computeVarianceDrivers` and the legacy branches in the API will be deleted.

## 15. Final output checklist

## 15. Definition of done

Slice 5 is complete only when:

* Week Review reads the active deterministic evaluation for the selected week;
* owner-facing drivers reconcile mathematically to transaction-based forecast variance, leaving cash-reconciliation difference strictly separate;
* timing shifts are presented correctly;
* unresolved cash is visible and not mislabeled;
* detailed attribution evidence is available;
* cash reconciliation remains independent and intact;
* legacy weeks are handled honestly;
* Close Week & Roll continues to work;
* strict deterministic tests pass;
* no AI, automatic learning or forecast-model replacement is introduced.

## 15. Final output checklist

1. **Proposed file-by-file change list:**
   - `src/app/api/variance-drivers/route.ts` (branch logic)
   - `src/services/deterministic-variance.ts` (new read service for Slice 1-4 records)
   - `src/ui/VarianceDriverPanel.tsx` (UI adaptation for timing shifts and evidence)
   - `src/types/variance.ts` (updated API contract types)
   - `test/services/deterministic-variance.test.ts` (new tests)
2. **Mathematical sign convention:** Defined in Section 3.
3. **API response contract:** Defined in Section 10.
4. **Test matrix:** Defined in Section 12.
5. **Migration requirement:** NO.
6. **Critical blocker found:** None. The evaluation tables perfectly align with the required read model.
7. **Confirmation of reuse:** Yes, the existing Week Review module (`/review`, `VarianceDriverPanel`) is heavily reused. No new dashboard is created.
