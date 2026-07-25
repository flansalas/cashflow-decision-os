-- AlterTable
ALTER TABLE "VendorProfile" ADD COLUMN     "defaultExpenseClass" TEXT NOT NULL DEFAULT 'unknown';

-- AlterTable
ALTER TABLE "PayableBill" ADD COLUMN     "expenseClass" TEXT NOT NULL DEFAULT 'unknown';
