-- DropIndex
DROP INDEX "ForecastEvaluationObservation_companyId_forecastCheckpointI_key";

-- AlterTable
ALTER TABLE "ForecastEvaluationObservation" ADD COLUMN     "isLatest" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

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

-- AddForeignKey
ALTER TABLE "EvaluationJob" ADD CONSTRAINT "EvaluationJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationJobTrigger" ADD CONSTRAINT "EvaluationJobTrigger_evaluationJobId_fkey" FOREIGN KEY ("evaluationJobId") REFERENCES "EvaluationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationJobTrigger" ADD CONSTRAINT "EvaluationJobTrigger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

