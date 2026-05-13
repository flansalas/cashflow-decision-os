-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clerkOrgId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyNote" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "noteText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "bankBalance" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAdjustment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "typicalDelayWeeks" INTEGER,
    "riskTag" TEXT NOT NULL DEFAULT 'low',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "criticality" TEXT NOT NULL DEFAULT 'normal',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivableInvoice" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "amountOpen" DOUBLE PRECISION NOT NULL,
    "daysPastDue" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceivableInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayableBill" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "billNo" TEXT NOT NULL,
    "billDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "amountOpen" DOUBLE PRECISION NOT NULL,
    "daysPastDue" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'open',
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayableBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assumption" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bufferMin" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "fixedWeeklyOutflow" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payrollCadence" TEXT NOT NULL DEFAULT 'biweekly',
    "payrollAllInAmount" DOUBLE PRECISION,
    "payrollNextDate" TIMESTAMP(3),
    "rentMonthlyAmount" DOUBLE PRECISION,
    "rentDayOfMonth" INTEGER,
    "paymentCurveJson" TEXT NOT NULL DEFAULT '{"current":0,"1-14":1,"15-30":2,"31-60":3,"61+":4}',
    "highRiskAgingDays" INTEGER NOT NULL DEFAULT 61,
    "projectionSafetyMargin" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accountId" TEXT,
    "txDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringPattern" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "typicalAmount" DOUBLE PRECISION NOT NULL,
    "amountStdDev" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cadence" TEXT NOT NULL,
    "nextExpectedDate" TIMESTAMP(3),
    "confidence" TEXT NOT NULL DEFAULT 'med',
    "category" TEXT NOT NULL DEFAULT 'other',
    "isIncluded" BOOLEAN NOT NULL DEFAULT true,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MappingProfile" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mappingJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MappingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Override" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "amount" DOUBLE PRECISION,
    "effectiveDate" TIMESTAMP(3),
    "metaJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "inputText" TEXT,
    "diffJson" TEXT NOT NULL,
    "forecastVersionHashAfter" TEXT NOT NULL,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastWeek" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "startCash" DOUBLE PRECISION NOT NULL,
    "inflowsExpected" DOUBLE PRECISION NOT NULL,
    "outflowsExpected" DOUBLE PRECISION NOT NULL,
    "endCashExpected" DOUBLE PRECISION NOT NULL,
    "inflowsBest" DOUBLE PRECISION NOT NULL,
    "outflowsBest" DOUBLE PRECISION NOT NULL,
    "endCashBest" DOUBLE PRECISION NOT NULL,
    "inflowsWorst" DOUBLE PRECISION NOT NULL,
    "outflowsWorst" DOUBLE PRECISION NOT NULL,
    "endCashWorst" DOUBLE PRECISION NOT NULL,
    "zone" TEXT NOT NULL,
    "confidenceScore" INTEGER NOT NULL DEFAULT 100,
    "breakdownJson" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forecastVersionHash" TEXT NOT NULL,

    CONSTRAINT "ForecastWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountImpact" DOUBLE PRECISION NOT NULL,
    "impactCertainty" TEXT NOT NULL,
    "constraintWeekStart" TIMESTAMP(3),
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "reasoningJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScenarioItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashFlowCategory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashFlowCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashFlowEntry" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashFlowEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastCheckpoint" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cashSnapshotId" TEXT NOT NULL,
    "snapshotSource" TEXT NOT NULL DEFAULT 'client_observed_v1',
    "forecastVersionHash" TEXT,
    "generatedAt" TIMESTAMP(3),
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "endCashExpected" DOUBLE PRECISION NOT NULL,
    "inflowsExpected" DOUBLE PRECISION NOT NULL,
    "outflowsExpected" DOUBLE PRECISION NOT NULL,
    "breakdownJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_clerkOrgId_key" ON "Company"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_companyId_txHash_key" ON "BankTransaction"("companyId", "txHash");

-- CreateIndex
CREATE UNIQUE INDEX "MappingProfile_companyId_kind_key" ON "MappingProfile"("companyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastWeek_companyId_weekStart_forecastVersionHash_key" ON "ForecastWeek"("companyId", "weekStart", "forecastVersionHash");

-- CreateIndex
CREATE UNIQUE INDEX "CashFlowCategory_companyId_name_direction_key" ON "CashFlowCategory"("companyId", "name", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastCheckpoint_cashSnapshotId_key" ON "ForecastCheckpoint"("cashSnapshotId");

-- AddForeignKey
ALTER TABLE "CompanyNote" ADD CONSTRAINT "CompanyNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashSnapshot" ADD CONSTRAINT "CashSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashAdjustment" ADD CONSTRAINT "CashAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorProfile" ADD CONSTRAINT "VendorProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceivableInvoice" ADD CONSTRAINT "ReceivableInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayableBill" ADD CONSTRAINT "PayableBill_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assumption" ADD CONSTRAINT "Assumption_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPattern" ADD CONSTRAINT "RecurringPattern_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MappingProfile" ADD CONSTRAINT "MappingProfile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Override" ADD CONSTRAINT "Override_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastWeek" ADD CONSTRAINT "ForecastWeek_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioItem" ADD CONSTRAINT "ScenarioItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashFlowCategory" ADD CONSTRAINT "CashFlowCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashFlowEntry" ADD CONSTRAINT "CashFlowEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashFlowEntry" ADD CONSTRAINT "CashFlowEntry_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CashFlowCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastCheckpoint" ADD CONSTRAINT "ForecastCheckpoint_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastCheckpoint" ADD CONSTRAINT "ForecastCheckpoint_cashSnapshotId_fkey" FOREIGN KEY ("cashSnapshotId") REFERENCES "CashSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

