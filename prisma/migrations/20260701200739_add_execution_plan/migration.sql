-- CreateTable
CREATE TABLE "BaselineVarianceLedger" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "projectedOutflow" DOUBLE PRECISION NOT NULL,
    "actualOutflow" DOUBLE PRECISION NOT NULL,
    "variancePct" DOUBLE PRECISION NOT NULL,
    "projectedInflow" DOUBLE PRECISION,
    "actualInflow" DOUBLE PRECISION,
    "variancePctIn" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BaselineVarianceLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionPlan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "planHash" TEXT NOT NULL,
    "itemsJson" JSONB NOT NULL,
    "summaryJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "supersededByPlanId" TEXT,

    CONSTRAINT "ExecutionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BaselineVarianceLedger_companyId_weekStart_idx" ON "BaselineVarianceLedger"("companyId", "weekStart");

-- CreateIndex
CREATE INDEX "ExecutionPlan_companyId_weekStart_status_idx" ON "ExecutionPlan"("companyId", "weekStart", "status");

-- CreateIndex
CREATE INDEX "ExecutionPlan_companyId_weekStart_version_idx" ON "ExecutionPlan"("companyId", "weekStart", "version");

-- CreateIndex
CREATE INDEX "ExecutionPlan_companyId_status_idx" ON "ExecutionPlan"("companyId", "status");

-- AddForeignKey
ALTER TABLE "BaselineVarianceLedger" ADD CONSTRAINT "BaselineVarianceLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPlan" ADD CONSTRAINT "ExecutionPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
