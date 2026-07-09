-- AlterTable
ALTER TABLE "StagedImportRow" ADD COLUMN     "appliedAt" TIMESTAMP(3),
ADD COLUMN     "appliedRecordId" TEXT,
ADD COLUMN     "applyError" TEXT,
ADD COLUMN     "applyStatus" TEXT;

-- CreateTable
CREATE TABLE "ImportApplication" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "importType" TEXT NOT NULL,
    "appliedBy" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "forecastHashBefore" TEXT,
    "forecastHashAfter" TEXT,
    "changeLogId" TEXT,

    CONSTRAINT "ImportApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportApplication_importBatchId_key" ON "ImportApplication"("importBatchId");

-- AddForeignKey
ALTER TABLE "ImportApplication" ADD CONSTRAINT "ImportApplication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportApplication" ADD CONSTRAINT "ImportApplication_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
