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

-- CreateIndex
CREATE INDEX "ForecastComponentSnapshot_forecastCheckpointId_idx" ON "ForecastComponentSnapshot"("forecastCheckpointId");

-- AddForeignKey
ALTER TABLE "ForecastComponentSnapshot" ADD CONSTRAINT "ForecastComponentSnapshot_forecastCheckpointId_fkey" FOREIGN KEY ("forecastCheckpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

