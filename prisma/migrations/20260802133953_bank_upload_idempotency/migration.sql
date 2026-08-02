-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_companyId_fileHash_key" ON "ImportBatch"("companyId", "fileHash");

