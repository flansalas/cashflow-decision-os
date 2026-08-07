-- CreateTable
CREATE TABLE "TestMigrationVerify" (
    "id" TEXT NOT NULL,

    CONSTRAINT "TestMigrationVerify_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "matchedAmount" DECIMAL(65,30) NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'high',
    "status" TEXT NOT NULL DEFAULT 'active',
    "matchMethod" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReconciliationLink_sourceType_sourceId_idx" ON "ReconciliationLink"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "ReconciliationLink_targetType_targetId_idx" ON "ReconciliationLink"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ReconciliationLink_companyId_idx" ON "ReconciliationLink"("companyId");

-- AddForeignKey
ALTER TABLE "ReconciliationLink" ADD CONSTRAINT "ReconciliationLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
