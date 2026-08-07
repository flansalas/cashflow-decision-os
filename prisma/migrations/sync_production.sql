-- DropIndex
DROP INDEX "ForecastEvaluationObservation_companyId_forecastCheckpointI_key";

-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ForecastCheckpoint" ADD COLUMN     "bankCoverageEvidenceJson" TEXT,
ADD COLUMN     "isBankCoverageVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ForecastEvaluationObservation" ADD COLUMN     "isLatest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "InternalTransferHistory" (
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

-- CreateTable
CREATE TABLE "EvaluationJob" (
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

-- CreateTable
CREATE TABLE "EvaluationJobTrigger" (
    "id" TEXT NOT NULL,
    "evaluationJobId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationJobTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestMigrationVerify" (
    "id" TEXT NOT NULL,

    CONSTRAINT "TestMigrationVerify_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InternalTransferHistory_companyId_pairId_idx" ON "InternalTransferHistory"("companyId", "pairId");

-- CreateIndex
CREATE INDEX "InternalTransferHistory_companyId_isActive_idx" ON "InternalTransferHistory"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "EvaluationJob_companyId_status_idx" ON "EvaluationJob"("companyId", "status");

-- CreateIndex
CREATE INDEX "EvaluationJob_status_claimExpiresAt_idx" ON "EvaluationJob"("status", "claimExpiresAt");

-- CreateIndex
CREATE INDEX "EvaluationJobTrigger_evaluationJobId_idx" ON "EvaluationJobTrigger"("evaluationJobId");

-- CreateIndex
CREATE INDEX "idx_latest_observation" ON "ForecastEvaluationObservation"("companyId", "forecastCheckpointId", "maturedWeekStart", "horizonWeeks", "model", "direction", "stage", "isLatest");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastEvaluationObservation_companyId_forecastCheckpointI_key" ON "ForecastEvaluationObservation"("companyId", "forecastCheckpointId", "maturedWeekStart", "horizonWeeks", "model", "direction", "stage", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_companyId_fileHash_key" ON "ImportBatch"("companyId", "fileHash");

-- AddForeignKey
ALTER TABLE "InternalTransferHistory" ADD CONSTRAINT "InternalTransferHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalTransferHistory" ADD CONSTRAINT "InternalTransferHistory_txId1_fkey" FOREIGN KEY ("txId1") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalTransferHistory" ADD CONSTRAINT "InternalTransferHistory_txId2_fkey" FOREIGN KEY ("txId2") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationJob" ADD CONSTRAINT "EvaluationJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationJobTrigger" ADD CONSTRAINT "EvaluationJobTrigger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationJobTrigger" ADD CONSTRAINT "EvaluationJobTrigger_evaluationJobId_fkey" FOREIGN KEY ("evaluationJobId") REFERENCES "EvaluationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

