-- Migration: 20260709_memory_hardening
-- Adds memory hardening structures for payment behavior, import batch tracking,
-- and audit consistency improvements.
-- Safe to apply incrementally; all new columns are nullable or have defaults.

-- ─── 1. Audit consistency: add forecastVersionHashBefore to ChangeLog ─────────
-- Existing rows will have NULL for this column; that is correct and readable.
ALTER TABLE "ChangeLog" ADD COLUMN IF NOT EXISTS "forecastVersionHashBefore" TEXT;

-- ─── 2. CustomerPaymentObservation (append-only) ─────────────────────────────
CREATE TABLE IF NOT EXISTS "CustomerPaymentObservation" (
    "id"                  TEXT NOT NULL,
    "companyId"           TEXT NOT NULL,
    "customerName"        TEXT NOT NULL,
    "invoiceId"           TEXT,
    "invoiceNo"           TEXT,
    "dueDate"             TIMESTAMP(3),
    "expectedPaymentDate" TIMESTAMP(3),
    "actualPaymentDate"   TIMESTAMP(3) NOT NULL,
    "daysEarlyOrLate"     INTEGER NOT NULL,
    "amount"              DOUBLE PRECISION NOT NULL,
    "paymentSource"       TEXT NOT NULL,
    "observedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPaymentObservation_pkey" PRIMARY KEY ("id")
);

-- Tenant isolation index
CREATE INDEX IF NOT EXISTS "CustomerPaymentObservation_companyId_customerName_idx"
    ON "CustomerPaymentObservation"("companyId", "customerName");

-- Duplicate prevention: one observation per invoice per payment date
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerPaymentObservation_companyId_invoiceId_actualPaymentDate_key"
    ON "CustomerPaymentObservation"("companyId", "invoiceId", "actualPaymentDate");

-- Foreign key to Company
ALTER TABLE "CustomerPaymentObservation"
    ADD CONSTRAINT "CustomerPaymentObservation_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 3. VendorPaymentObservation (append-only) ───────────────────────────────
CREATE TABLE IF NOT EXISTS "VendorPaymentObservation" (
    "id"                 TEXT NOT NULL,
    "companyId"          TEXT NOT NULL,
    "vendorName"         TEXT NOT NULL,
    "billId"             TEXT,
    "billNo"             TEXT,
    "dueDate"            TIMESTAMP(3),
    "plannedPaymentDate" TIMESTAMP(3),
    "actualPaymentDate"  TIMESTAMP(3) NOT NULL,
    "daysEarlyOrLate"    INTEGER NOT NULL,
    "amount"             DOUBLE PRECISION NOT NULL,
    "paymentSource"      TEXT NOT NULL,
    "observedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorPaymentObservation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VendorPaymentObservation_companyId_vendorName_idx"
    ON "VendorPaymentObservation"("companyId", "vendorName");

CREATE UNIQUE INDEX IF NOT EXISTS "VendorPaymentObservation_companyId_billId_actualPaymentDate_key"
    ON "VendorPaymentObservation"("companyId", "billId", "actualPaymentDate");

ALTER TABLE "VendorPaymentObservation"
    ADD CONSTRAINT "VendorPaymentObservation_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── 4. ImportBatch ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ImportBatch" (
    "id"               TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "importType"       TEXT NOT NULL,
    "filename"         TEXT NOT NULL,
    "uploadedBy"       TEXT,
    "uploadedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rowCount"         INTEGER NOT NULL,
    "acceptedCount"    INTEGER NOT NULL DEFAULT 0,
    "rejectedCount"    INTEGER NOT NULL DEFAULT 0,
    "duplicateCount"   INTEGER NOT NULL DEFAULT 0,
    "status"           TEXT NOT NULL DEFAULT 'success',
    "sourceDateStart"  TIMESTAMP(3),
    "sourceDateEnd"    TIMESTAMP(3),
    "fileHash"         TEXT,
    "mappingProfileId" TEXT,
    "errorSummary"     TEXT,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ImportBatch_companyId_importType_idx"
    ON "ImportBatch"("companyId", "importType");

ALTER TABLE "ImportBatch"
    ADD CONSTRAINT "ImportBatch_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
