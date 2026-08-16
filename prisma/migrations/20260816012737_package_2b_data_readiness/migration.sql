

-- CreateTable
CREATE TABLE "DataReadinessAttestation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeKey" TEXT,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "controlCount" INTEGER,
    "controlAmount" DOUBLE PRECISION,
    "sourceStateHash" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "certifiedBy" TEXT NOT NULL,
    "certifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataReadinessAttestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyDataReadinessCertification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "forecastCheckpointId" TEXT,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "evidenceJson" TEXT NOT NULL,
    "blockingReasonsJson" TEXT,
    "certifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyDataReadinessCertification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataReadinessAttestation_companyId_scopeType_idx" ON "DataReadinessAttestation"("companyId", "scopeType");

-- CreateIndex
CREATE INDEX "DataReadinessAttestation_companyId_status_idx" ON "DataReadinessAttestation"("companyId", "status");

-- CreateIndex
CREATE INDEX "CompanyDataReadinessCertification_companyId_status_idx" ON "CompanyDataReadinessCertification"("companyId", "status");

-- CreateIndex
CREATE INDEX "CompanyDataReadinessCertification_forecastCheckpointId_idx" ON "CompanyDataReadinessCertification"("forecastCheckpointId");

-- AddForeignKey
ALTER TABLE "DataReadinessAttestation" ADD CONSTRAINT "DataReadinessAttestation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDataReadinessCertification" ADD CONSTRAINT "CompanyDataReadinessCertification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDataReadinessCertification" ADD CONSTRAINT "CompanyDataReadinessCertification_forecastCheckpointId_fkey" FOREIGN KEY ("forecastCheckpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
