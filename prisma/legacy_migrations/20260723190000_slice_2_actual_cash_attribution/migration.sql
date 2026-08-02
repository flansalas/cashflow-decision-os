-- CreateTable
CREATE TABLE "ActualCashAttribution" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "targetWeekStart" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL,
    "componentCategory" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "amountAttributed" DOUBLE PRECISION NOT NULL,
    "confidenceTier" TEXT NOT NULL,
    "isUserVerified" BOOLEAN NOT NULL DEFAULT false,
    "isReclassified" BOOLEAN NOT NULL DEFAULT false,
    "attributionRunId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActualCashAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActualCashAttribution_companyId_targetWeekStart_idx" ON "ActualCashAttribution"("companyId", "targetWeekStart");

-- CreateIndex
CREATE INDEX "ActualCashAttribution_attributionRunId_idx" ON "ActualCashAttribution"("attributionRunId");

-- AddForeignKey
ALTER TABLE "ActualCashAttribution" ADD CONSTRAINT "ActualCashAttribution_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActualCashAttribution" ADD CONSTRAINT "ActualCashAttribution_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

