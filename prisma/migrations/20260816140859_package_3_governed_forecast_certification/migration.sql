-- CreateTable
CREATE TABLE "ForecastScenario" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "forecastCheckpointId" TEXT NOT NULL,
    "scenarioHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stressInputsJson" TEXT NOT NULL,
    "scenarioPayloadJson" TEXT NOT NULL,
    "minCash" DOUBLE PRECISION NOT NULL,
    "minCashWeek" TIMESTAMP(3) NOT NULL,
    "firstNegativeWeek" TIMESTAMP(3),
    "maxDeficit" DOUBLE PRECISION,
    "bufferHeadroom" DOUBLE PRECISION NOT NULL,
    "firstBreachWeek" TIMESTAMP(3),

    CONSTRAINT "ForecastScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForecastVersionCertification" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "forecastCheckpointId" TEXT NOT NULL,
    "downsideScenarioId" TEXT,
    "status" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "baseMinCash" DOUBLE PRECISION NOT NULL,
    "baseMinCashWeek" TIMESTAMP(3) NOT NULL,
    "baseFirstNegativeWeek" TIMESTAMP(3),
    "baseMaxDeficit" DOUBLE PRECISION,
    "baseBufferHeadroom" DOUBLE PRECISION NOT NULL,
    "baseFirstBreachWeek" TIMESTAMP(3),
    "downsideMinCash" DOUBLE PRECISION,
    "downsideMinCashWeek" TIMESTAMP(3),
    "downsideFirstNegativeWeek" TIMESTAMP(3),
    "downsideMaxDeficit" DOUBLE PRECISION,
    "downsideBufferHeadroom" DOUBLE PRECISION,
    "downsideFirstBreachWeek" TIMESTAMP(3),
    "bufferAmount" DOUBLE PRECISION NOT NULL,
    "bufferRationale" TEXT,
    "readinessCertificationId" TEXT,
    "evidenceJson" TEXT NOT NULL,
    "rationale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForecastVersionCertification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ForecastScenario_companyId_forecastCheckpointId_scenarioHas_key" ON "ForecastScenario"("companyId", "forecastCheckpointId", "scenarioHash");

-- CreateIndex
CREATE INDEX "ForecastVersionCertification_companyId_forecastCheckpointId_idx" ON "ForecastVersionCertification"("companyId", "forecastCheckpointId");

-- CreateIndex
CREATE INDEX "ForecastVersionCertification_companyId_status_idx" ON "ForecastVersionCertification"("companyId", "status");

-- AddForeignKey
ALTER TABLE "ForecastScenario" ADD CONSTRAINT "ForecastScenario_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastScenario" ADD CONSTRAINT "ForecastScenario_forecastCheckpointId_fkey" FOREIGN KEY ("forecastCheckpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastVersionCertification" ADD CONSTRAINT "ForecastVersionCertification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastVersionCertification" ADD CONSTRAINT "ForecastVersionCertification_forecastCheckpointId_fkey" FOREIGN KEY ("forecastCheckpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForecastVersionCertification" ADD CONSTRAINT "ForecastVersionCertification_downsideScenarioId_fkey" FOREIGN KEY ("downsideScenarioId") REFERENCES "ForecastScenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ForecastScenario immutability trigger
CREATE OR REPLACE FUNCTION prevent_forecast_scenario_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ForecastScenario records are immutable and cannot be updated.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_forecast_scenario_immutability
BEFORE UPDATE ON "ForecastScenario"
FOR EACH ROW
EXECUTE FUNCTION prevent_forecast_scenario_update();

CREATE OR REPLACE FUNCTION prevent_forecast_scenario_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ForecastScenario records are immutable and cannot be deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_forecast_scenario_no_delete
BEFORE DELETE ON "ForecastScenario"
FOR EACH ROW
EXECUTE FUNCTION prevent_forecast_scenario_delete();

-- ForecastVersionCertification immutability trigger
CREATE OR REPLACE FUNCTION prevent_forecast_version_certification_update()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."status" = 'certified' OR OLD."status" = 'cannot_certify' OR OLD."status" = 'not_safe' THEN
        -- Only status transitions might be allowed if we decide, but for now we enforce full immutability of the row once inserted.
        RAISE EXCEPTION 'ForecastVersionCertification records are immutable and cannot be updated.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_forecast_version_certification_immutability
BEFORE UPDATE ON "ForecastVersionCertification"
FOR EACH ROW
EXECUTE FUNCTION prevent_forecast_version_certification_update();

CREATE OR REPLACE FUNCTION prevent_forecast_version_certification_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ForecastVersionCertification records are immutable and cannot be deleted.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_forecast_version_certification_no_delete
BEFORE DELETE ON "ForecastVersionCertification"
FOR EACH ROW
EXECUTE FUNCTION prevent_forecast_version_certification_delete();
