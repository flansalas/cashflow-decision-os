-- Create partial unique index to enforce exactly one sealed forecast per company per semantic hash
CREATE UNIQUE INDEX "ForecastCheckpoint_companyId_forecastVersionHash_sealedAt_key" 
ON "ForecastCheckpoint"("companyId", "forecastVersionHash") 
WHERE "sealedAt" IS NOT NULL;
