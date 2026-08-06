-- Schema Reconciliation Migration
-- This migration formally records schema changes previously applied via
-- the ad-hoc sync_production.sql script, and removes the test-only
-- TestMigrationVerify table that was created as a migration canary artifact.
--
-- Changes reconciled from sync_production.sql:
--   1. BankAccount.isActive (from 20260802193909_bank_coverage_verification)
--   2. InternalTransferHistory table (from 20260802185603_internal_transfer_history)
--   3. EvaluationJob + EvaluationJobTrigger tables (from 20260802_add_evaluation_jobs)
--   4. ImportBatch unique index on (companyId, fileHash) (from 20260802133953_bank_upload_idempotency)
--   5. ForecastCheckpoint columns (bankCoverageEvidenceJson, isBankCoverageVerified)
--   6. ForecastEvaluationObservation columns + index changes (version, isLatest, supersededAt)
-- All of the above are already applied to the production database.
--
-- Artifact removed:
--   TestMigrationVerify table (test canary, not part of application schema)

-- Drop test-only canary table
DROP TABLE IF EXISTS "TestMigrationVerify";

-- The following are already applied; using IF NOT EXISTS guards for safety.

-- BankAccount.isActive
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='BankAccount' AND column_name='isActive'
    ) THEN
        ALTER TABLE "BankAccount" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
    END IF;
END $$;

-- ForecastCheckpoint columns
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='ForecastCheckpoint' AND column_name='bankCoverageEvidenceJson'
    ) THEN
        ALTER TABLE "ForecastCheckpoint" 
            ADD COLUMN "bankCoverageEvidenceJson" TEXT,
            ADD COLUMN "isBankCoverageVerified" BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- ForecastEvaluationObservation columns
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='ForecastEvaluationObservation' AND column_name='isLatest'
    ) THEN
        ALTER TABLE "ForecastEvaluationObservation" 
            ADD COLUMN "isLatest" BOOLEAN NOT NULL DEFAULT true,
            ADD COLUMN "supersededAt" TIMESTAMP(3),
            ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
    END IF;
END $$;

-- InternalTransferHistory table
CREATE TABLE IF NOT EXISTS "InternalTransferHistory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "txId1" TEXT NOT NULL,
    "txId2" TEXT NOT NULL,
    "pairedByUserId" TEXT NOT NULL,
    "pairedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unpairedByUserId" TEXT,
    "unpairedAt" TIMESTAMP(3),
    "unpairReason" TEXT,
    "evidenceJson" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "InternalTransferHistory_pkey" PRIMARY KEY ("id")
);

-- EvaluationJob table
CREATE TABLE IF NOT EXISTS "EvaluationJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "claimedBy" TEXT,
    "claimExpiresAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureDetails" TEXT,
    "retryAfter" TIMESTAMP(3),
    CONSTRAINT "EvaluationJob_pkey" PRIMARY KEY ("id")
);

-- EvaluationJobTrigger table
CREATE TABLE IF NOT EXISTS "EvaluationJobTrigger" (
    "id" TEXT NOT NULL,
    "evaluationJobId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationJobTrigger_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "InternalTransferHistory_companyId_pairId_idx" ON "InternalTransferHistory"("companyId", "pairId");
CREATE INDEX IF NOT EXISTS "InternalTransferHistory_companyId_isActive_idx" ON "InternalTransferHistory"("companyId", "isActive");
CREATE INDEX IF NOT EXISTS "EvaluationJob_companyId_status_idx" ON "EvaluationJob"("companyId", "status");
CREATE INDEX IF NOT EXISTS "EvaluationJob_status_claimExpiresAt_idx" ON "EvaluationJob"("status", "claimExpiresAt");
CREATE INDEX IF NOT EXISTS "EvaluationJobTrigger_evaluationJobId_idx" ON "EvaluationJobTrigger"("evaluationJobId");
CREATE INDEX IF NOT EXISTS "idx_latest_observation" ON "ForecastEvaluationObservation"("companyId", "forecastCheckpointId", "maturedWeekStart", "horizonWeeks", "model", "direction", "stage", "isLatest");

-- ImportBatch unique index
CREATE UNIQUE INDEX IF NOT EXISTS "ImportBatch_companyId_fileHash_key" ON "ImportBatch"("companyId", "fileHash");

-- Foreign Keys (IF NOT EXISTS guards)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='InternalTransferHistory_companyId_fkey') THEN
        ALTER TABLE "InternalTransferHistory" ADD CONSTRAINT "InternalTransferHistory_companyId_fkey" 
            FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='InternalTransferHistory_txId1_fkey') THEN
        ALTER TABLE "InternalTransferHistory" ADD CONSTRAINT "InternalTransferHistory_txId1_fkey"
            FOREIGN KEY ("txId1") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='InternalTransferHistory_txId2_fkey') THEN
        ALTER TABLE "InternalTransferHistory" ADD CONSTRAINT "InternalTransferHistory_txId2_fkey"
            FOREIGN KEY ("txId2") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EvaluationJob_companyId_fkey') THEN
        ALTER TABLE "EvaluationJob" ADD CONSTRAINT "EvaluationJob_companyId_fkey"
            FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EvaluationJobTrigger_companyId_fkey') THEN
        ALTER TABLE "EvaluationJobTrigger" ADD CONSTRAINT "EvaluationJobTrigger_companyId_fkey"
            FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='EvaluationJobTrigger_evaluationJobId_fkey') THEN
        ALTER TABLE "EvaluationJobTrigger" ADD CONSTRAINT "EvaluationJobTrigger_evaluationJobId_fkey"
            FOREIGN KEY ("evaluationJobId") REFERENCES "EvaluationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- ForecastEvaluationObservation unique index reconciliation
-- The old index without 'version' was dropped by sync_production.sql.
-- The new versioned index was created by sync_production.sql.
-- This is a no-op if already applied; IF NOT EXISTS guards protect against re-apply.
CREATE UNIQUE INDEX IF NOT EXISTS "ForecastEvaluationObservation_companyId_forecastCheckpointI_key"
    ON "ForecastEvaluationObservation"("companyId", "forecastCheckpointId", "maturedWeekStart", "horizonWeeks", "model", "direction", "stage", "version");
