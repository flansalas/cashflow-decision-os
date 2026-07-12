-- AlterTable
ALTER TABLE "ActionItem" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "ActionItem" ADD COLUMN "completionNote" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN "dueDate" TIMESTAMP(3);
ALTER TABLE "ActionItem" ADD COLUMN "executionPlanId" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN "ownerName" TEXT;
ALTER TABLE "ActionItem" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'planned';

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_executionPlanId_fkey" FOREIGN KEY ("executionPlanId") REFERENCES "ExecutionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ActionItem_executionPlanId_idx" ON "ActionItem"("executionPlanId");
CREATE INDEX "ActionItem_companyId_status_idx" ON "ActionItem"("companyId", "status");
