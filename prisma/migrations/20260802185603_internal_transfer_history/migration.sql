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

-- CreateIndex
CREATE INDEX "InternalTransferHistory_companyId_pairId_idx" ON "InternalTransferHistory"("companyId", "pairId");

-- CreateIndex
CREATE INDEX "InternalTransferHistory_companyId_isActive_idx" ON "InternalTransferHistory"("companyId", "isActive");

-- AddForeignKey
ALTER TABLE "InternalTransferHistory" ADD CONSTRAINT "InternalTransferHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalTransferHistory" ADD CONSTRAINT "InternalTransferHistory_txId1_fkey" FOREIGN KEY ("txId1") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalTransferHistory" ADD CONSTRAINT "InternalTransferHistory_txId2_fkey" FOREIGN KEY ("txId2") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
