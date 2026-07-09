-- CreateTable
CREATE TABLE "StagedImportRow" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "importType" TEXT NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "rawDataJson" TEXT NOT NULL,
    "normalizedDataJson" TEXT NOT NULL,
    "validationStatus" TEXT NOT NULL,
    "validationErrorsJson" TEXT,
    "duplicateStatus" TEXT NOT NULL,
    "proposedAction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StagedImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StagedImportRow_companyId_importBatchId_idx" ON "StagedImportRow"("companyId", "importBatchId");

-- AddForeignKey
ALTER TABLE "StagedImportRow" ADD CONSTRAINT "StagedImportRow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedImportRow" ADD CONSTRAINT "StagedImportRow_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
