-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "ForecastCheckpoint" ADD COLUMN     "bankCoverageEvidenceJson" TEXT,
ADD COLUMN     "isBankCoverageVerified" BOOLEAN NOT NULL DEFAULT false;
