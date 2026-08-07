# Forward Evidence Collection: Operational Runbook

This runbook defines the standard operating procedures, data expectations, and monitoring tasks for the forward evidence collection pipeline. It ensures valid paired evidence for M1, M4, and the AI layer accumulates correctly without contaminating historical ledgers.

## 1. Weekly Actions for the Pilot User

To generate valid training evidence, the pilot user must complete the following standard workflow:
1. **Import Data:** Complete all expected bank transaction imports for the closing week.
2. **Reconcile Allocations:** Ensure all transactions are categorically mapped, resolving any outstanding or ambiguous allocations.
3. **Weekly Check-In:** Complete the Weekly Cash Check-In operation on time.
4. **Lock & Verify:** Lock the week with complete coverage, advancing the forecast to the next period.

## 2. Week State Definitions

* **Operationally Completed:** The user has finished the Weekly Cash Check-In and advanced the forecast in the UI.
* **Verified:** The check-in completed with `isBankCoverageVerified = true`, indicating complete account coverage and no missing data boundaries.
* **Matured:** Calendar time has elapsed past the predicted horizon (up to 13 weeks), meaning actual ground-truth financials are final and knowable.
* **Valid for Evaluation:** A matured week that originated from a strictly verified check-in, containing no inconclusive data, making it safe for AI/M4 training evidence.
* **Inconclusive:** A week lacking complete coverage, verification, or containing conflicting data. It remains operationally visible to the user but is strictly prevented from updating training ledgers or generating observations.

## 3. Expected Database Records by Stage

* **ForecastCheckpoint:** Created immediately upon Weekly Check-In. Captures the exact context, company state, and origin time of the prediction.
* **BaselineSnapshotHistory:** Created alongside the checkpoint by `shadow-evaluation.ts`. Persists the raw predictions in a strict 13-horizon `ResidualForecastSeries` JSON shape.
* **EvaluationJob (and Triggers):** Queued automatically when the system detects matured horizons during subsequent check-ins or imports. Processed by `evaluation-job-worker.ts`.
* **ForecastEvaluationObservation:** Created by `canonical-evaluator.ts` upon successful job execution for valid matured weeks. Stores exact pairings, MAE, and Bias for M1, M4, and AI.

## 4. Weekly Read-Only Verification Checklist

Use read-only queries against the production replica to verify the pipeline is collecting evidence:

- [ ] **M1 Stage 2 Exists:** Confirm `BaselineSnapshotHistory` rows have valid 13-horizon JSON in the M1 Stage 2 fields.
- [ ] **M4 Stage 2 Exists:** Confirm `m4PreAiResidualJson` is populated and properly serialized.
- [ ] **M1 Stage 3 Exists:** Confirm `m1Stage3Json` is populated.
- [ ] **Coverage Status:** Verify `ForecastCheckpoint.isBankCoverageVerified` correctly identifies verified vs. inconclusive check-ins.
- [ ] **Jobs Are Processing:** Query `EvaluationJob` to ensure no jobs are permanently stuck in `PENDING` or `FAILED` states.
- [ ] **Observations Created:** Confirm `ForecastEvaluationObservation` rows are actively generating for matured horizons with `isLatest = true`.

## 5. Escalation Rules

The system is designed to run autonomously in shadow mode. **DO NOT intervene, quarantine, or adjust the codebase unless:**

1. Predictions or evidence pairs are silently missing, malformed, or truncating horizons.
2. `EvaluationJob` workers are repeatedly failing or getting stuck.
3. Upstream changes are made to production M1 deterministic accounting formulas.
4. M4 predictions inadvertently leak out of shadow evaluation and affect live user behavior.
