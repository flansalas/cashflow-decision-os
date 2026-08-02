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
    "description" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'system',
    "status" TEXT NOT NULL DEFAULT 'active',
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
    "defaultExpenseClass" TEXT NOT NULL DEFAULT 'unknown',
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
    "expenseClass" TEXT NOT NULL DEFAULT 'unknown',
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
    "internalTransferStatus" TEXT NOT NULL DEFAULT 'unresolved',
    "internalTransferPairId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActualCashAttribution" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "checkpointId" TEXT,
    "bankTransactionId" TEXT NOT NULL,
    "targetWeekStart" TIMESTAMP(3) NOT NULL,
    "maturedForecastWeek" TIMESTAMP(3),
    "direction" TEXT NOT NULL,
    "componentCategory" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "amountAttributed" DOUBLE PRECISION NOT NULL,
    "confidenceTier" TEXT NOT NULL,
    "attributionMethod" TEXT NOT NULL DEFAULT 'unknown',
    "isUserVerified" BOOLEAN NOT NULL DEFAULT false,
    "isReclassified" BOOLEAN NOT NULL DEFAULT false,
    "attributionRunId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActualCashAttribution_pkey" PRIMARY KEY ("id")
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
    "description" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'system',
    "status" TEXT NOT NULL DEFAULT 'active',
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
    "forecastVersionHashBefore" TEXT,
    "forecastVersionHashAfter" TEXT NOT NULL,
    "userId" TEXT,

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
    "actualAmountImpact" DOUBLE PRECISION,
    "impactCertainty" TEXT NOT NULL,
    "constraintWeekStart" TIMESTAMP(3),
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "reasoningJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executionPlanId" TEXT,
    "ownerName" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'planned',
    "completedAt" TIMESTAMP(3),
    "completionNote" TEXT,

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
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "supersededAt" TIMESTAMP(3),
    "supersededByPlanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" TEXT,
    "revisionReason" TEXT,
    "forecastStateJson" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "actualEndingCash" DOUBLE PRECISION,

    CONSTRAINT "ExecutionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPaymentObservation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "invoiceId" TEXT,
    "invoiceNo" TEXT,
    "dueDate" TIMESTAMP(3),
    "expectedPaymentDate" TIMESTAMP(3),
    "actualPaymentDate" TIMESTAMP(3) NOT NULL,
    "daysEarlyOrLate" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentSource" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPaymentObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPaymentObservation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorName" TEXT NOT NULL,
    "billId" TEXT,
    "billNo" TEXT,
    "dueDate" TIMESTAMP(3),
    "plannedPaymentDate" TIMESTAMP(3),
    "actualPaymentDate" TIMESTAMP(3) NOT NULL,
    "daysEarlyOrLate" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paymentSource" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorPaymentObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "importType" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount" INTEGER NOT NULL,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'success',
    "sourceDateStart" TIMESTAMP(3),
    "sourceDateEnd" TIMESTAMP(3),
    "fileHash" TEXT,
    "mappingProfileId" TEXT,
    "errorSummary" TEXT,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankImportManifest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userCertified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankImportManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankImportManifestAccount" (
    "id" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "rawSourceAccountId" TEXT,
    "coveredStartDate" TIMESTAMP(3),
    "coveredEndDate" TIMESTAMP(3),
    "userCertifiedAt" TIMESTAMP(3),
    "importSuccess" BOOLEAN NOT NULL DEFAULT false,
    "rejectedRowCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BankImportManifestAccount_pkey" PRIMARY KEY ("id")
);

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
    "conflictType" TEXT NOT NULL,
    "matchedRecordId" TEXT,
    "fieldDifferencesJson" TEXT,
    "proposedAction" TEXT NOT NULL,
    "userDecision" TEXT,
    "linkedRecordId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "rollbackStatus" TEXT,
    "rollbackError" TEXT,
    "applyStatus" TEXT,
    "appliedRecordId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "applyError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StagedImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportApplication" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "importType" TEXT NOT NULL,
    "appliedBy" TEXT,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "rolledBackAt" TIMESTAMP(3),
    "rolledBackBy" TEXT,
    "forecastHashBeforeRollback" TEXT,
    "forecastHashAfterRollback" TEXT,
    "rollbackEnrichmentError" TEXT,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "forecastHashBefore" TEXT,
    "forecastHashAfter" TEXT,
    "enrichmentError" TEXT,
    "changeLogId" TEXT,

    CONSTRAINT "ImportApplication_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "LearningProposal" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "proposedChangeJson" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidenceActionIds" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "LearningProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaselineSnapshot" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "hasSufficientHistory" BOOLEAN NOT NULL,
    "baselineConfidenceTier" TEXT NOT NULL,
    "inflowCadence" TEXT NOT NULL,
    "outflowCadence" TEXT NOT NULL,
    "variableInflowWeekly" DOUBLE PRECISION NOT NULL,
    "variableOutflowWeekly" DOUBLE PRECISION NOT NULL,
    "variableInflowBand" DOUBLE PRECISION NOT NULL,
    "variableOutflowBand" DOUBLE PRECISION NOT NULL,
    "conservativeInflowWeekly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "conservativeOutflowWeekly" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "weeklyBucketsJson" TEXT NOT NULL DEFAULT '[]',
    "aiInflowFactorsJson" TEXT,
    "aiOutflowFactorsJson" TEXT,
    "aiInflowExplanationsJson" TEXT,
    "aiOutflowExplanationsJson" TEXT,
    "aiReasoningLogJson" TEXT,
    "weeklyInflowCoverageJson" TEXT,
    "weeklyOutflowCoverageJson" TEXT,
    "evidenceStateJson" TEXT,
    "rawAiResponseJson" TEXT,
    "promptVersionHash" TEXT,
    "modelIdentifier" TEXT,
    "aiGeneratedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BaselineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastComponentSnapshot" (
    "id" TEXT NOT NULL,
    "forecastCheckpointId" TEXT NOT NULL,
    "targetWeekStart" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL,
    "componentCategory" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sourceAmountAtForecast" DOUBLE PRECISION,
    "sourceDateAtForecast" TIMESTAMP(3),
    "sourceStatusAtForecast" TEXT,
    "overrideId" TEXT,
    "projectedAmount" DOUBLE PRECISION NOT NULL,
    "confidenceTier" TEXT NOT NULL,
    "sourceStateJson" TEXT,
    "sourceStateHash" TEXT NOT NULL,
    "isUserOverridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastComponentSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BaselineSnapshotHistory" (
    "id" TEXT NOT NULL,
    "forecastCheckpointId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "variableInflowWeekly" DOUBLE PRECISION NOT NULL,
    "variableOutflowWeekly" DOUBLE PRECISION NOT NULL,
    "m1EstimatorVersion" TEXT,
    "m4EstimatorVersion" TEXT,
    "preprocessingVersion" TEXT,
    "forecastAssemblyVersion" TEXT,
    "attributionVersion" TEXT,
    "promptVersionHash" TEXT,
    "modelIdentifier" TEXT,
    "appCommitHash" TEXT,
    "explicitInflowJson" JSONB,
    "explicitOutflowJson" JSONB,
    "coverageDiagnosticsJson" JSONB,
    "evidenceStateJson" JSONB,
    "m1RawBaselineJson" JSONB,
    "m1ExplicitDeductionJson" JSONB,
    "m1PreAiResidualJson" JSONB,
    "m1AiFactorJson" JSONB,
    "m1PostAiResidualJson" JSONB,
    "m1FinalProductionTotalJson" JSONB,
    "m4RawBaselineJson" JSONB,
    "m4ExplicitDeductionJson" JSONB,
    "m4PreAiResidualJson" JSONB,
    "fallbackStatus" TEXT NOT NULL DEFAULT 'none',
    "dataQualityStatus" TEXT NOT NULL DEFAULT 'valid',
    "rawAiResponseJson" TEXT,
    "reasoningLog" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BaselineSnapshotHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountFreshnessStatus" (
    "id" TEXT NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "latestTransactionDate" TIMESTAMP(3),
    "ingestionTimestamp" TIMESTAMP(3),
    "coverageStatus" TEXT NOT NULL,
    "manualSourceManifest" TEXT,
    "completenessEvidence" TEXT,

    CONSTRAINT "AccountFreshnessStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastEvaluationRun" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "checkpointId" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluationLogicVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expectedInflows" DOUBLE PRECISION NOT NULL,
    "actualInflows" DOUBLE PRECISION NOT NULL,
    "inflowVariance" DOUBLE PRECISION NOT NULL,
    "expectedOutflows" DOUBLE PRECISION NOT NULL,
    "actualOutflows" DOUBLE PRECISION NOT NULL,
    "outflowVariance" DOUBLE PRECISION NOT NULL,
    "expectedNetCash" DOUBLE PRECISION NOT NULL,
    "actualNetCash" DOUBLE PRECISION NOT NULL,
    "netVariance" DOUBLE PRECISION NOT NULL,
    "aggregateMetricsJson" TEXT,

    CONSTRAINT "ForecastEvaluationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastComponentEvaluation" (
    "id" TEXT NOT NULL,
    "evaluationRunId" TEXT NOT NULL,
    "snapshotId" TEXT,
    "expectedAmount" DOUBLE PRECISION NOT NULL,
    "actualAmount" DOUBLE PRECISION NOT NULL,
    "varianceAmount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "confidenceTier" TEXT NOT NULL,
    "actualDate" TIMESTAMP(3),
    "daysShifted" INTEGER,
    "shiftDirection" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastComponentEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastComponentEvaluationAttribution" (
    "evidenceRole" TEXT NOT NULL DEFAULT 'current_week_actual',
    "id" TEXT NOT NULL,
    "componentEvaluationId" TEXT NOT NULL,
    "actualCashAttributionId" TEXT NOT NULL,
    "amountApplied" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastComponentEvaluationAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastEvaluationObservation" (
    "id" TEXT NOT NULL,
    "forecastCheckpointId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "maturedWeekStart" TIMESTAMP(3) NOT NULL,
    "horizonWeeks" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "predictionAmount" DOUBLE PRECISION NOT NULL,
    "canonicalActual" DOUBLE PRECISION NOT NULL,
    "absoluteError" DOUBLE PRECISION NOT NULL,
    "signedError" DOUBLE PRECISION NOT NULL,
    "dangerousSide" BOOLEAN NOT NULL,
    "sensitivityActual" DOUBLE PRECISION,
    "sensitivityAbsoluteError" DOUBLE PRECISION,
    "sensitivitySignedError" DOUBLE PRECISION,
    "sensitivityDangerousSide" BOOLEAN,
    "attributionAmbiguity" TEXT NOT NULL,
    "accountCompleteness" TEXT NOT NULL,
    "evaluationValidity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastEvaluationObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_clerkOrgId_key" ON "Company"("clerkOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransaction_companyId_txHash_key" ON "BankTransaction"("companyId", "txHash");

-- CreateIndex
CREATE INDEX "ActualCashAttribution_companyId_targetWeekStart_idx" ON "ActualCashAttribution"("companyId", "targetWeekStart");

-- CreateIndex
CREATE INDEX "ActualCashAttribution_attributionRunId_idx" ON "ActualCashAttribution"("attributionRunId");

-- CreateIndex
CREATE INDEX "ActualCashAttribution_bankTransactionId_isActive_idx" ON "ActualCashAttribution"("bankTransactionId", "isActive");

-- CreateIndex
CREATE INDEX "ActualCashAttribution_checkpointId_idx" ON "ActualCashAttribution"("checkpointId");

-- CreateIndex
CREATE UNIQUE INDEX "RecurringPattern_companyId_merchantKey_key" ON "RecurringPattern"("companyId", "merchantKey");

-- CreateIndex
CREATE UNIQUE INDEX "MappingProfile_companyId_kind_key" ON "MappingProfile"("companyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastWeek_companyId_weekStart_forecastVersionHash_key" ON "ForecastWeek"("companyId", "weekStart", "forecastVersionHash");

-- CreateIndex
CREATE INDEX "ActionItem_executionPlanId_idx" ON "ActionItem"("executionPlanId");

-- CreateIndex
CREATE INDEX "ActionItem_companyId_status_idx" ON "ActionItem"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CashFlowCategory_companyId_name_direction_key" ON "CashFlowCategory"("companyId", "name", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastCheckpoint_cashSnapshotId_key" ON "ForecastCheckpoint"("cashSnapshotId");

-- CreateIndex
CREATE INDEX "BaselineVarianceLedger_companyId_weekStart_idx" ON "BaselineVarianceLedger"("companyId", "weekStart");

-- CreateIndex
CREATE INDEX "ExecutionPlan_companyId_weekStart_idx" ON "ExecutionPlan"("companyId", "weekStart");

-- CreateIndex
CREATE INDEX "CustomerPaymentObservation_companyId_customerName_idx" ON "CustomerPaymentObservation"("companyId", "customerName");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPaymentObservation_companyId_invoiceId_actualPaymen_key" ON "CustomerPaymentObservation"("companyId", "invoiceId", "actualPaymentDate");

-- CreateIndex
CREATE INDEX "VendorPaymentObservation_companyId_vendorName_idx" ON "VendorPaymentObservation"("companyId", "vendorName");

-- CreateIndex
CREATE UNIQUE INDEX "VendorPaymentObservation_companyId_billId_actualPaymentDate_key" ON "VendorPaymentObservation"("companyId", "billId", "actualPaymentDate");

-- CreateIndex
CREATE INDEX "ImportBatch_companyId_importType_idx" ON "ImportBatch"("companyId", "importType");

-- CreateIndex
CREATE INDEX "StagedImportRow_companyId_importBatchId_idx" ON "StagedImportRow"("companyId", "importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportApplication_importBatchId_key" ON "ImportApplication"("importBatchId");

-- CreateIndex
CREATE INDEX "ImportApplyChange_companyId_importApplicationId_idx" ON "ImportApplyChange"("companyId", "importApplicationId");

-- CreateIndex
CREATE INDEX "LearningProposal_companyId_status_idx" ON "LearningProposal"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BaselineSnapshot_companyId_key" ON "BaselineSnapshot"("companyId");

-- CreateIndex
CREATE INDEX "ForecastComponentSnapshot_forecastCheckpointId_idx" ON "ForecastComponentSnapshot"("forecastCheckpointId");

-- CreateIndex
CREATE UNIQUE INDEX "BaselineSnapshotHistory_forecastCheckpointId_key" ON "BaselineSnapshotHistory"("forecastCheckpointId");

-- CreateIndex
CREATE INDEX "BaselineSnapshotHistory_companyId_idx" ON "BaselineSnapshotHistory"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountFreshnessStatus_checkpointId_accountId_key" ON "AccountFreshnessStatus"("checkpointId", "accountId");

-- CreateIndex
CREATE INDEX "ForecastEvaluationRun_companyId_weekStart_isActive_idx" ON "ForecastEvaluationRun"("companyId", "weekStart", "isActive");

-- CreateIndex
CREATE INDEX "ForecastEvaluationRun_checkpointId_idx" ON "ForecastEvaluationRun"("checkpointId");

-- CreateIndex
CREATE INDEX "ForecastComponentEvaluation_evaluationRunId_idx" ON "ForecastComponentEvaluation"("evaluationRunId");

-- CreateIndex
CREATE INDEX "ForecastComponentEvaluation_snapshotId_idx" ON "ForecastComponentEvaluation"("snapshotId");

-- CreateIndex
CREATE INDEX "ForecastComponentEvaluationAttribution_componentEvaluationI_idx" ON "ForecastComponentEvaluationAttribution"("componentEvaluationId");

-- CreateIndex
CREATE INDEX "ForecastComponentEvaluationAttribution_actualCashAttributio_idx" ON "ForecastComponentEvaluationAttribution"("actualCashAttributionId");

-- CreateIndex
CREATE INDEX "ForecastEvaluationObservation_forecastCheckpointId_idx" ON "ForecastEvaluationObservation"("forecastCheckpointId");

-- CreateIndex
CREATE INDEX "ForecastEvaluationObservation_companyId_model_idx" ON "ForecastEvaluationObservation"("companyId", "model");

-- CreateIndex
CREATE UNIQUE INDEX "ForecastEvaluationObservation_companyId_forecastCheckpointI_key" ON "ForecastEvaluationObservation"("companyId", "forecastCheckpointId", "maturedWeekStart", "horizonWeeks", "model", "direction", "stage");

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
ALTER TABLE "ActualCashAttribution" ADD CONSTRAINT "ActualCashAttribution_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActualCashAttribution" ADD CONSTRAINT "ActualCashAttribution_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActualCashAttribution" ADD CONSTRAINT "ActualCashAttribution_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_executionPlanId_fkey" FOREIGN KEY ("executionPlanId") REFERENCES "ExecutionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "BaselineVarianceLedger" ADD CONSTRAINT "BaselineVarianceLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionPlan" ADD CONSTRAINT "ExecutionPlan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPaymentObservation" ADD CONSTRAINT "CustomerPaymentObservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPaymentObservation" ADD CONSTRAINT "VendorPaymentObservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImportManifest" ADD CONSTRAINT "BankImportManifest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImportManifestAccount" ADD CONSTRAINT "BankImportManifestAccount_manifestId_fkey" FOREIGN KEY ("manifestId") REFERENCES "BankImportManifest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImportManifestAccount" ADD CONSTRAINT "BankImportManifestAccount_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedImportRow" ADD CONSTRAINT "StagedImportRow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagedImportRow" ADD CONSTRAINT "StagedImportRow_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportApplication" ADD CONSTRAINT "ImportApplication_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportApplication" ADD CONSTRAINT "ImportApplication_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportApplyChange" ADD CONSTRAINT "ImportApplyChange_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportApplyChange" ADD CONSTRAINT "ImportApplyChange_importApplicationId_fkey" FOREIGN KEY ("importApplicationId") REFERENCES "ImportApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProposal" ADD CONSTRAINT "LearningProposal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineSnapshot" ADD CONSTRAINT "BaselineSnapshot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastComponentSnapshot" ADD CONSTRAINT "ForecastComponentSnapshot_forecastCheckpointId_fkey" FOREIGN KEY ("forecastCheckpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineSnapshotHistory" ADD CONSTRAINT "BaselineSnapshotHistory_forecastCheckpointId_fkey" FOREIGN KEY ("forecastCheckpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BaselineSnapshotHistory" ADD CONSTRAINT "BaselineSnapshotHistory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountFreshnessStatus" ADD CONSTRAINT "AccountFreshnessStatus_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "BaselineSnapshotHistory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastEvaluationRun" ADD CONSTRAINT "ForecastEvaluationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastEvaluationRun" ADD CONSTRAINT "ForecastEvaluationRun_checkpointId_fkey" FOREIGN KEY ("checkpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastComponentEvaluation" ADD CONSTRAINT "ForecastComponentEvaluation_evaluationRunId_fkey" FOREIGN KEY ("evaluationRunId") REFERENCES "ForecastEvaluationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastComponentEvaluation" ADD CONSTRAINT "ForecastComponentEvaluation_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ForecastComponentSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastComponentEvaluationAttribution" ADD CONSTRAINT "ForecastComponentEvaluationAttribution_componentEvaluation_fkey" FOREIGN KEY ("componentEvaluationId") REFERENCES "ForecastComponentEvaluation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastComponentEvaluationAttribution" ADD CONSTRAINT "ForecastComponentEvaluationAttribution_actualCashAttributi_fkey" FOREIGN KEY ("actualCashAttributionId") REFERENCES "ActualCashAttribution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastEvaluationObservation" ADD CONSTRAINT "ForecastEvaluationObservation_forecastCheckpointId_fkey" FOREIGN KEY ("forecastCheckpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastEvaluationObservation" ADD CONSTRAINT "ForecastEvaluationObservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

