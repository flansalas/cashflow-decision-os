-- Package 1B fix: Remove the obsolete unique index on cashSnapshotId.
-- The unique CONSTRAINT was dropped in 20260813160000_package_1b_immutable_forecast,
-- but PostgreSQL retains the backing unique index unless explicitly dropped.
-- ForecastCheckpoint now supports one-to-many from CashSnapshot (many checkpoints
-- per snapshot are permitted). The non-unique lookup index
-- ForecastCheckpoint_cashSnapshotId_idx remains and is sufficient.

DROP INDEX IF EXISTS "ForecastCheckpoint_cashSnapshotId_key";
