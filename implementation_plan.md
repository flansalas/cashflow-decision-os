# Phase 2: Production Bank-Data Restoration and Safeguard Implementation Plan

## Goal
Restore the missing canonical bank transaction history for Cascio using the verified offline QuickBooks dataset, correct the global bank importer deduplication defect to prevent future data loss, and implement a global baseline data-loss guard.

## User Review Required
> [!WARNING]
> **Production Database Mutation Required**
> Do not approve this plan until you have safely rotated the production Neon database credentials and confirmed that the exposed credentials have been invalidated. I will execute the restoration using the new credentials.

## Reconciling the Recovery Datasets
Why does the `StagedImportRow` staging data differ from the `frozen_backtest_dataset.json`?
* **Staging Data (1,606 rows)**: This data is what was actually uploaded via the application's UI import flow. It only covers the main `Spending` account from June 2025 to July 2026.
* **Frozen QuickBooks Dataset (3,283 rows)**: This dataset was derived from `scratch/qb_report.csv` (an offline QuickBooks export) during our earlier backtesting phase. It spans 4 accounts and contains the full history from July 2024 to July 2026, including 122 transfer pairs.

**Decision**: The restoration will proceed using the richer `frozen_backtest_dataset.json` (hash `a6bdc3301a76abf8e3aabc6d2aa5761685fc72d163695bdc4dc94ae778eae667`) which is confirmed to contain:
* Exactly 3,283 rows across 4 accounts.
* Dates ranging from July 1, 2024 to July 31, 2026.
* Total inflows: $20,737,814.83, Total outflows: $15,536,808.23.
* 122 resolved transfer pairs.
* 2 legitimate same-day duplicate rows (which the old importer logic would have incorrectly discarded).

## Proposed Changes

### 1. Importer Deduplication Correction
We will fix the global defect that caused the application to discard valid same-day transactions of identical amounts.

#### [MODIFY] `src/app/api/upload/bank/route.ts`
* Change `BankTransaction` inserts to populate the optional `txHash` field with a strict composite identity: `${accountId}|||${fileHash}|||${index}`.
* Update `getBankFingerprint` to return the identical fingerprint: `${accountId}|||${fileHash}|||${index}`.
* Exact duplicate file uploads will be perfectly caught (identical fileHash and row indices). Overlapping files with the same dates/amounts but different hashes will correctly flag as `possible_duplicate` (review required). Same-day valid duplicates inside the *same* file will be correctly allowed as they have different `index` values.

### 2. Baseline Data-Loss Guard
We will implement a fallback mechanism preventing the system from automatically zeroing out a valid historical baseline.

#### [MODIFY] `src/services/baseline-snapshot.ts`
* Update `buildAndCacheBaseline` to first load the pre-existing snapshot.
* If the newly computed baseline yields `hasSufficientHistory: false` but the existing baseline was `hasSufficientHistory: true`, we intercept the save operation.
* We will preserve the numerical baseline properties of the existing snapshot and update `baselineConfidenceTier` to `"degraded_data_loss"`.
* We will log an explicit data-integrity event into the `ChangeLog` table (action: `baseline_data_loss_detected`).

### 3. Data Restoration Execution
Upon approval and credential rotation, I will:
* Verify the new production credential.
* Use a Node script to directly insert the 3,283 rows from `frozen_backtest_dataset.json` into the production `BankTransaction` table.
* The script will map the 4 string account names to actual `BankAccount` UUIDs (creating missing `BankAccount` records for the 3 non-spending accounts if they don't exist).
* Trigger the baseline reconstruction endpoint to promote the restored history into the active dashboard view.

## Verification Plan

### Automated Verification
* The restoration script will assert that exactly 3,283 rows were inserted into `BankTransaction`.
* Query `ChangeLog` after the baseline trigger to ensure no `baseline_data_loss_detected` events fired during the correct build.

### Manual Verification
* Once complete, the user can load the dashboard and verify that the `variableInflowWeekly` and `variableOutflowWeekly` have returned to their correct historical averages (approx ~$135,535/wk inflows).
