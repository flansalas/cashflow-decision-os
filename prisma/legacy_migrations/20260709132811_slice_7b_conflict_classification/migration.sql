/*
  Warnings:

  - You are about to drop the column `duplicateStatus` on the `StagedImportRow` table. All the data in the column will be lost.
  - Added the required column `conflictType` to the `StagedImportRow` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "StagedImportRow" DROP COLUMN "duplicateStatus",
ADD COLUMN     "conflictType" TEXT NOT NULL,
ADD COLUMN     "fieldDifferencesJson" TEXT,
ADD COLUMN     "matchedRecordId" TEXT;
