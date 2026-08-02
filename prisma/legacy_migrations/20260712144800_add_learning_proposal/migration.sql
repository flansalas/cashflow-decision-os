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

-- CreateIndex
CREATE INDEX "LearningProposal_companyId_status_idx" ON "LearningProposal"("companyId", "status");

-- AddForeignKey
ALTER TABLE "LearningProposal" ADD CONSTRAINT "LearningProposal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
