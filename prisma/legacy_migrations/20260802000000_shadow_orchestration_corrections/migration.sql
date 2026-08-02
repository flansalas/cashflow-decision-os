-- AlterTable
ALTER TABLE "AccountFreshnessStatus" ADD COLUMN     "completenessEvidence" TEXT;

-- CreateTable
CREATE TABLE "ForecastEvaluationObservation" (
    "id" TEXT NOT NULL,
    "forecastCheckpointId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "maturedWeekStart" TIMESTAMP(3) NOT NULL,
    "horizonWeeks" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "stage1RawPrediction" DOUBLE PRECISION NOT NULL,
    "stage2PreAiPrediction" DOUBLE PRECISION NOT NULL,
    "stage3AiFactor" DOUBLE PRECISION,
    "canonicalActual" DOUBLE PRECISION NOT NULL,
    "absoluteError" DOUBLE PRECISION NOT NULL,
    "signedError" DOUBLE PRECISION NOT NULL,
    "dangerousSide" BOOLEAN NOT NULL,
    "attributionAmbiguity" TEXT NOT NULL,
    "accountCompleteness" TEXT NOT NULL,
    "evaluationValidity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastEvaluationObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ForecastEvaluationObservation_forecastCheckpointId_idx" ON "ForecastEvaluationObservation"("forecastCheckpointId");

-- CreateIndex
CREATE INDEX "ForecastEvaluationObservation_companyId_model_idx" ON "ForecastEvaluationObservation"("companyId", "model");

-- AddForeignKey
ALTER TABLE "ForecastEvaluationObservation" ADD CONSTRAINT "ForecastEvaluationObservation_forecastCheckpointId_fkey" FOREIGN KEY ("forecastCheckpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastEvaluationObservation" ADD CONSTRAINT "ForecastEvaluationObservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

