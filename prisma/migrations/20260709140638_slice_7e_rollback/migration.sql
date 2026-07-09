-- AlterTable
ALTER TABLE "ImportApplication" ADD COLUMN     "forecastHashAfterRollback" TEXT,
ADD COLUMN     "forecastHashBeforeRollback" TEXT,
ADD COLUMN     "rollbackEnrichmentError" TEXT,
ADD COLUMN     "rolledBackAt" TIMESTAMP(3),
ADD COLUMN     "rolledBackBy" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'applied';

-- AlterTable
ALTER TABLE "StagedImportRow" ADD COLUMN     "rollbackError" TEXT,
ADD COLUMN     "rollbackStatus" TEXT;

-- CreateTable
CREATE TABLE "ImportApplyChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "importApplicationId" TEXT NOT NULL,
    "stagedRowId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "beforeJson" TEXT,
    "afterJson" TEXT NOT NULL,
    "changedFieldsJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportApplyChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportApplyChange_companyId_importApplicationId_idx" ON "ImportApplyChange"("companyId", "importApplicationId");

-- AddForeignKey
ALTER TABLE "ImportApplyChange" ADD CONSTRAINT "ImportApplyChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportApplyChange" ADD CONSTRAINT "ImportApplyChange_importApplicationId_fkey" FOREIGN KEY ("importApplicationId") REFERENCES "ImportApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
