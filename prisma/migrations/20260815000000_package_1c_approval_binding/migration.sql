-- AlterTable
ALTER TABLE "ExecutionPlan" ADD COLUMN "forecastCheckpointId" TEXT,
ADD COLUMN "approvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ExecutionPlan_forecastCheckpointId_idx" ON "ExecutionPlan"("forecastCheckpointId");
CREATE INDEX "ExecutionPlan_companyId_weekStart_status_idx" ON "ExecutionPlan"("companyId", "weekStart", "status");

-- AddForeignKey
ALTER TABLE "ExecutionPlan" ADD CONSTRAINT "ExecutionPlan_forecastCheckpointId_fkey" FOREIGN KEY ("forecastCheckpointId") REFERENCES "ForecastCheckpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create partial unique index
CREATE UNIQUE INDEX "ExecutionPlan_companyId_weekStart_approved_key" 
ON "ExecutionPlan"("companyId", "weekStart") 
WHERE status = 'approved' AND "forecastCheckpointId" IS NOT NULL;

-- Create ExecutionPlan Immutability Trigger Function
CREATE OR REPLACE FUNCTION trg_execution_plan_immutable_fn()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'superseded', 'executed') THEN
      RAISE EXCEPTION 'Cannot delete ExecutionPlan once it has reached a terminal/historical state (approved, superseded, executed).';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IN ('approved', 'superseded', 'executed') THEN
      -- Prevent all core changes
      IF NEW."companyId" != OLD."companyId" OR
         NEW."weekStart" != OLD."weekStart" OR
         NEW."version" != OLD."version" OR
         NEW."forecastCheckpointId" IS DISTINCT FROM OLD."forecastCheckpointId" OR
         NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy" OR
         NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt" OR
         NEW."revisionReason" IS DISTINCT FROM OLD."revisionReason"
      THEN
         RAISE EXCEPTION 'Cannot mutate core ExecutionPlan instructions during or after approved state.';
      END IF;

      -- Allow approved -> superseded transition, updating only supersededAt and supersededByPlanId
      IF OLD.status = 'approved' AND NEW.status = 'superseded' THEN
         RETURN NEW;
      END IF;

      -- Allow approved -> executed transition, updating only reviewedAt, actualEndingCash
      IF OLD.status = 'approved' AND NEW.status = 'executed' THEN
         RETURN NEW;
      END IF;

      -- Prevent status from moving backward or changing randomly
      IF NEW.status != OLD.status THEN
         RAISE EXCEPTION 'Invalid status transition from % to %.', OLD.status, NEW.status;
      END IF;

      -- If status is exactly the same, protect terminal status updates (superseded/executed)
      IF OLD.status IN ('superseded', 'executed') THEN
         IF NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt" OR
            NEW."supersededByPlanId" IS DISTINCT FROM OLD."supersededByPlanId" OR
            NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt" OR
            NEW."actualEndingCash" IS DISTINCT FROM OLD."actualEndingCash" 
         THEN
            RAISE EXCEPTION 'Cannot mutate fields of a superseded or executed ExecutionPlan.';
         END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create Trigger
DROP TRIGGER IF EXISTS trg_execution_plan_immutable ON "ExecutionPlan";
CREATE TRIGGER trg_execution_plan_immutable
BEFORE UPDATE OR DELETE ON "ExecutionPlan"
FOR EACH ROW
EXECUTE FUNCTION trg_execution_plan_immutable_fn();

-- Create ActionItem Immutability Trigger Function
CREATE OR REPLACE FUNCTION trg_action_item_immutable_fn()
RETURNS TRIGGER AS $$
DECLARE
  plan_status TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."executionPlanId" IS NOT NULL THEN
      SELECT status INTO plan_status FROM "ExecutionPlan" WHERE id = NEW."executionPlanId";
      IF plan_status IN ('approved', 'superseded', 'executed') THEN
        RAISE EXCEPTION 'Cannot insert new ActionItem into an approved, superseded, or executed ExecutionPlan.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD."executionPlanId" IS NOT NULL THEN
      SELECT status INTO plan_status FROM "ExecutionPlan" WHERE id = OLD."executionPlanId";
      IF plan_status IN ('approved', 'superseded', 'executed') THEN
        RAISE EXCEPTION 'Cannot delete ActionItem from an approved, superseded, or executed ExecutionPlan.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."executionPlanId" IS NOT NULL THEN
      SELECT status INTO plan_status FROM "ExecutionPlan" WHERE id = OLD."executionPlanId";
      IF plan_status IN ('approved', 'superseded', 'executed') THEN
        -- Ensure instruction fields are unchanged
        IF NEW."ownerName" IS DISTINCT FROM OLD."ownerName" OR
           NEW."dueDate" IS DISTINCT FROM OLD."dueDate" OR
           NEW."amountImpact" IS DISTINCT FROM OLD."amountImpact" OR
           NEW."constraintWeekStart" IS DISTINCT FROM OLD."constraintWeekStart" OR
           NEW."type" IS DISTINCT FROM OLD."type" OR
           NEW."title" IS DISTINCT FROM OLD."title" OR
           NEW."description" IS DISTINCT FROM OLD."description" OR
           NEW."targetType" IS DISTINCT FROM OLD."targetType" OR
           NEW."targetId" IS DISTINCT FROM OLD."targetId" OR
           NEW."reasoningJson" IS DISTINCT FROM OLD."reasoningJson" OR
           NEW."priority" IS DISTINCT FROM OLD."priority" OR
           NEW."impactCertainty" IS DISTINCT FROM OLD."impactCertainty" OR
           NEW."executionPlanId" IS DISTINCT FROM OLD."executionPlanId"
        THEN
          RAISE EXCEPTION 'Cannot mutate ActionItem core instructions once its ExecutionPlan is approved, superseded, or executed.';
        END IF;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create Trigger
DROP TRIGGER IF EXISTS trg_action_item_immutable ON "ActionItem";
CREATE TRIGGER trg_action_item_immutable
BEFORE INSERT OR UPDATE OR DELETE ON "ActionItem"
FOR EACH ROW
EXECUTE FUNCTION trg_action_item_immutable_fn();
