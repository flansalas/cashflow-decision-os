-- CreateTable
CREATE TABLE "ForecastEvaluationRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluationLogicVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expectedInflows" DOUBLE PRECISION NOT NULL,
    "actualInflows" DOUBLE PRECISION NOT NULL,
    "inflowVariance" DOUBLE PRECISION NOT NULL,
    "expectedOutflows" DOUBLE PRECISION NOT NULL,
    "actualOutflows" DOUBLE PRECISION NOT NULL,
    "outflowVariance" DOUBLE PRECISION NOT NULL,
    "expectedNetCash" DOUBLE PRECISION NOT NULL,
    "actualNetCash" DOUBLE PRECISION NOT NULL,
    "netVariance" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ForecastEvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastComponentEvaluation" (
    "id" TEXT NOT NULL,
    "evaluationRunId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "expectedAmount" DOUBLE PRECISION NOT NULL,
    "actualAmount" DOUBLE PRECISION NOT NULL,
    "varianceAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "confidenceTier" TEXT NOT NULL,
    "actualDate" TIMESTAMP(3),
    "daysShifted" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastComponentEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastComponentEvaluationAttribution" (
    "id" TEXT NOT NULL,
    "componentEvaluationId" TEXT NOT NULL,
    "actualCashAttributionId" TEXT NOT NULL,
    "amountApplied" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastComponentEvaluationAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForecastEvaluationRun_companyId_weekStart_isActive_idx" ON "ForecastEvaluationRun"("companyId", "weekStart", "isActive");

-- CreateIndex
CREATE INDEX "ForecastEvaluationRun_checkpointId_idx" ON "ForecastEvaluationRun"("checkpointId");

-- CreateIndex
CREATE INDEX "ForecastComponentEvaluation_evaluationRunId_idx" ON "ForecastComponentEvaluation"("evaluationRunId");

-- CreateIndex
CREATE INDEX "ForecastComponentEvaluation_snapshotId_idx" ON "ForecastComponentEvaluation"("snapshotId");

-- CreateIndex
CREATE INDEX "ForecastComponentEvaluationAttribution_componentEvaluationI_idx" ON "ForecastComponentEvaluationAttribution"("componentEvaluationId");

-- CreateIndex
CREATE INDEX "ForecastComponentEvaluationAttribution_actualCashAttributio_idx" ON "ForecastComponentEvaluationAttribution"("actualCashAttributionId");

-- AddForeignKey
ALTER TABLE "ForecastEvaluationRun" ADD CONSTRAINT "ForecastEvaluationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastEvaluationRun" ADD CONSTRAINT "ForecastEvaluationRun_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastComponentEvaluation" ADD CONSTRAINT "ForecastComponentEvaluation_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "ForecastEvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastComponentEvaluation" ADD CONSTRAINT "ForecastComponentEvaluation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ForecastComponentSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastComponentEvaluationAttribution" ADD CONSTRAINT "ForecastComponentEvaluationAttribution_componentEvaluation_fkey" FOREIGN KEY ("componentEvaluationId") REFERENCES "ForecastComponentEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastComponentEvaluationAttribution" ADD CONSTRAINT "ForecastComponentEvaluationAttribution_actualCashAttributi_fkey" FOREIGN KEY ("actualCashAttributionId") REFERENCES "ActualCashAttribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

