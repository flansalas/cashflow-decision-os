-- AlterTable
ALTER TABLE "ChangeLog" ADD COLUMN     "userId" TEXT;

-- RenameIndex
ALTER INDEX "CustomerPaymentObservation_companyId_invoiceId_actualPaymentDat" RENAME TO "CustomerPaymentObservation_companyId_invoiceId_actualPaymen_key";
