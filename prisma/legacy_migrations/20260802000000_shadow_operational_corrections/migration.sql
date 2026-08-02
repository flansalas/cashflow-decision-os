-- AlterTable
ALTER TABLE "BankTransaction" ADD COLUMN "internalTransferStatus" TEXT NOT NULL DEFAULT 'unresolved',
ADD COLUMN "internalTransferPairId" TEXT;

-- AlterTable
ALTER TABLE "ActualCashAttribution" ADD COLUMN "checkpointId" TEXT,
ADD COLUMN "maturedForecastWeek" TIMESTAMP(3),
ADD COLUMN "attributionMethod" TEXT NOT NULL DEFAULT 'unknown';

-- CreateTable
CREATE TABLE "BankImportManifest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userCertified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankImportManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankImportManifestAccount" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "rawSourceAccountId" TEXT,
    "coveredStartDate" TIMESTAMP(3),
    "coveredEndDate" TIMESTAMP(3),
    "userCertifiedAt" TIMESTAMP(3),
    "importSuccess" BOOLEAN NOT NULL DEFAULT false,
    "rejectedRowCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BankImportManifestAccount_pkey" PRIMARY KEY ("id")
);

-- DropTable
DROP TABLE IF EXISTS "ForecastAttributionAllocation" CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "ForecastEvaluationObservation_companyId_forecastCheckpointId_maturedWeekStart_horizonWeeks_model_direction_stage_key" ON "ForecastEvaluationObservation"("companyId", "forecastCheckpointId", "maturedWeekStart", "horizonWeeks", "model", "direction", "stage");

-- AddForeignKey
ALTER TABLE "BankImportManifest" ADD CONSTRAINT "BankImportManifest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImportManifestAccount" ADD CONSTRAINT "BankImportManifestAccount_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "BankImportManifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImportManifestAccount" ADD CONSTRAINT "BankImportManifestAccount_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
