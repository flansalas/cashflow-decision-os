-- AlterTable
ALTER TABLE "ForecastComponentEvaluation" ADD COLUMN "shiftDirection" TEXT;

-- AlterTable
ALTER TABLE "ForecastComponentEvaluationAttribution" ADD COLUMN "evidenceRole" TEXT NOT NULL DEFAULT 'current_week_actual';
