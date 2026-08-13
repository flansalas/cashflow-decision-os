-- Package 1B: Immutable Forecast Truth Spine

-- ============================================================
-- 1. ForecastCheckpoint: Remove @unique from cashSnapshotId
-- ============================================================
-- Drop the unique constraint on cashSnapshotId (allow one-to-many)
ALTER TABLE "ForecastCheckpoint" DROP CONSTRAINT IF EXISTS "ForecastCheckpoint_cashSnapshotId_key";

-- Add new nullable sealed-version fields
ALTER TABLE "ForecastCheckpoint" ADD COLUMN IF NOT EXISTS "forecastSchemaVersion" INTEGER;
ALTER TABLE "ForecastCheckpoint" ADD COLUMN IF NOT EXISTS "hashAlgorithm" TEXT;
ALTER TABLE "ForecastCheckpoint" ADD COLUMN IF NOT EXISTS "canonicalPayloadJson" TEXT;
ALTER TABLE "ForecastCheckpoint" ADD COLUMN IF NOT EXISTS "sealedAt" TIMESTAMP(3);

-- Add indexes for sealed version lookups
CREATE INDEX IF NOT EXISTS "ForecastCheckpoint_companyId_forecastVersionHash_idx"
    ON "ForecastCheckpoint"("companyId", "forecastVersionHash");
CREATE INDEX IF NOT EXISTS "ForecastCheckpoint_cashSnapshotId_idx"
    ON "ForecastCheckpoint"("cashSnapshotId");

-- ============================================================
-- 2. ForecastWeek: Add forecastCheckpointId relation
-- ============================================================
ALTER TABLE "ForecastWeek" ADD COLUMN IF NOT EXISTS "forecastCheckpointId" TEXT;

-- Add foreign key
ALTER TABLE "ForecastWeek"
    ADD CONSTRAINT "ForecastWeek_forecastCheckpointId_fkey"
    FOREIGN KEY ("forecastCheckpointId")
    REFERENCES "ForecastCheckpoint"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Add unique constraint and index
CREATE UNIQUE INDEX IF NOT EXISTS "ForecastWeek_forecastCheckpointId_weekStart_key"
    ON "ForecastWeek"("forecastCheckpointId", "weekStart");
CREATE INDEX IF NOT EXISTS "ForecastWeek_forecastCheckpointId_idx"
    ON "ForecastWeek"("forecastCheckpointId");

-- ============================================================
-- 3. CHECK constraint: Sealed rows must have all required fields
-- ============================================================
ALTER TABLE "ForecastCheckpoint" ADD CONSTRAINT "chk_sealed_completeness"
    CHECK (
        "sealedAt" IS NULL
        OR (
            "forecastVersionHash" IS NOT NULL
            AND "forecastSchemaVersion" IS NOT NULL
            AND "hashAlgorithm" IS NOT NULL
            AND "canonicalPayloadJson" IS NOT NULL
            AND "generatedAt" IS NOT NULL
        )
    );

-- ============================================================
-- 4. Immutability triggers for sealed ForecastCheckpoint
-- ============================================================

-- Prevent UPDATE or DELETE of sealed ForecastCheckpoint
CREATE OR REPLACE FUNCTION prevent_sealed_checkpoint_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD."sealedAt" IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot delete sealed ForecastCheckpoint %', OLD.id;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD."sealedAt" IS NOT NULL THEN
            -- Allow only the one-time seal transition: sealedAt NULL -> non-NULL
            -- After sealing, no further updates are permitted
            RAISE EXCEPTION 'Cannot update sealed ForecastCheckpoint %', OLD.id;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sealed_checkpoint_immutable ON "ForecastCheckpoint";
CREATE TRIGGER trg_sealed_checkpoint_immutable
    BEFORE UPDATE OR DELETE ON "ForecastCheckpoint"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_sealed_checkpoint_mutation();

-- ============================================================
-- 5. Immutability trigger for ForecastWeek linked to sealed checkpoint
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_sealed_week_mutation()
RETURNS TRIGGER AS $$
DECLARE
    checkpoint_sealed TIMESTAMP(3);
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."forecastCheckpointId" IS NOT NULL THEN
            SELECT "sealedAt" INTO checkpoint_sealed
            FROM "ForecastCheckpoint"
            WHERE id = NEW."forecastCheckpointId";
            IF checkpoint_sealed IS NOT NULL THEN
                RAISE EXCEPTION 'Cannot insert ForecastWeek into sealed checkpoint %', NEW."forecastCheckpointId";
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        IF OLD."forecastCheckpointId" IS NOT NULL THEN
            SELECT "sealedAt" INTO checkpoint_sealed
            FROM "ForecastCheckpoint"
            WHERE id = OLD."forecastCheckpointId";
            IF checkpoint_sealed IS NOT NULL THEN
                RAISE EXCEPTION 'Cannot modify ForecastWeek linked to sealed checkpoint %', OLD."forecastCheckpointId";
            END IF;
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sealed_week_immutable ON "ForecastWeek";
CREATE TRIGGER trg_sealed_week_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON "ForecastWeek"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_sealed_week_mutation();

-- ============================================================
-- 6. Immutability trigger for ForecastComponentSnapshot linked to sealed checkpoint
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_sealed_component_mutation()
RETURNS TRIGGER AS $$
DECLARE
    checkpoint_sealed TIMESTAMP(3);
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT "sealedAt" INTO checkpoint_sealed
        FROM "ForecastCheckpoint"
        WHERE id = NEW."forecastCheckpointId";
        IF checkpoint_sealed IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot insert ForecastComponentSnapshot into sealed checkpoint %', NEW."forecastCheckpointId";
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        SELECT "sealedAt" INTO checkpoint_sealed
        FROM "ForecastCheckpoint"
        WHERE id = OLD."forecastCheckpointId";
        IF checkpoint_sealed IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot modify ForecastComponentSnapshot linked to sealed checkpoint %', OLD."forecastCheckpointId";
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sealed_component_immutable ON "ForecastComponentSnapshot";
CREATE TRIGGER trg_sealed_component_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON "ForecastComponentSnapshot"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_sealed_component_mutation();

-- ============================================================
-- 7. Immutability trigger for BaselineSnapshotHistory linked to sealed checkpoint
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_sealed_baseline_history_mutation()
RETURNS TRIGGER AS $$
DECLARE
    checkpoint_sealed TIMESTAMP(3);
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT "sealedAt" INTO checkpoint_sealed
        FROM "ForecastCheckpoint"
        WHERE id = NEW."forecastCheckpointId";
        IF checkpoint_sealed IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot insert BaselineSnapshotHistory into sealed checkpoint %', NEW."forecastCheckpointId";
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
        SELECT "sealedAt" INTO checkpoint_sealed
        FROM "ForecastCheckpoint"
        WHERE id = OLD."forecastCheckpointId";
        IF checkpoint_sealed IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot modify BaselineSnapshotHistory linked to sealed checkpoint %', OLD."forecastCheckpointId";
        END IF;
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sealed_baseline_history_immutable ON "BaselineSnapshotHistory";
CREATE TRIGGER trg_sealed_baseline_history_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON "BaselineSnapshotHistory"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_sealed_baseline_history_mutation();
