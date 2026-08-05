import { parse } from "url";
import { PrismaClient } from "@prisma/client";
import { startOfWeek } from "date-fns";
import prisma from "../db/prisma";

const TARGET_HOST = "ep-lucky-salad-anvg05zg";

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const isConfirmed = args.includes("--confirm-isolated-preview");

  if (!isConfirmed) {
    console.error("Error: You must explicitly pass --confirm-isolated-preview to run this script.");
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("Error: DATABASE_URL is not set.");
    process.exit(1);
  }

  const parsedUrl = parse(dbUrl);
  if (!parsedUrl.hostname || !parsedUrl.hostname.includes(TARGET_HOST)) {
    console.error(`Error: DATABASE_URL hostname does not contain exact target host: ${TARGET_HOST}. Current host: ${parsedUrl.hostname}`);
    process.exit(1);
  }

  console.log(`Target host confirmed: ${parsedUrl.hostname}`);
  if (isDryRun) {
    console.log("--- DRY RUN MODE ---");
  }

  const companyId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb";
  const clerkOrgId = "org_3C5Tfg6SPRflDHu2cLuR3IfsuAR";
  
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const asOfDate = new Date();

  // IDs
  const checkingAccountId = "ff926efc-6619-4a71-9e22-d8532a5611b0";
  const syntheticAccountId = "430e5b93-e1c6-4f4a-b27c-863c98475cc5";
  
  const txInflowId = "11111111-1111-4111-b111-111111111111";
  const txOutflowId = "22222222-2222-4222-b222-222222222222";
  const txTransferInId = "33333333-3333-4333-b333-333333333333";
  const txTransferOutId = "44444444-4444-4444-b444-444444444444";
  
  const snapshotId = "55555555-5555-4555-b555-555555555555";
  const importBatchId = "66666666-6666-4666-b666-666666666666";
  const manifestId = "77777777-7777-4777-b777-777777777777";
  const checkpointId = "88888888-8888-4888-b888-888888888888";
  const triggerId = "99999999-9999-4999-b999-999999999999";
  const evalJobId = "00000000-0000-4000-b000-000000000000";

  try {
    if (isDryRun) {
      console.log(`[Dry Run] Would upsert Company: ${companyId}`);
      console.log(`[Dry Run] Would upsert CashSnapshot: ${snapshotId} ($50,000)`);
      console.log(`[Dry Run] Would upsert BankAccount: ${checkingAccountId}`);
      console.log(`[Dry Run] Would upsert BankAccount: ${syntheticAccountId}`);
      console.log(`[Dry Run] Would upsert BankTransaction: ${txInflowId} (+1000)`);
      console.log(`[Dry Run] Would upsert BankTransaction: ${txOutflowId} (-500)`);
      console.log(`[Dry Run] Would upsert BankTransaction: ${txTransferInId} (+200)`);
      console.log(`[Dry Run] Would upsert BankTransaction: ${txTransferOutId} (-200)`);
      console.log(`[Dry Run] Would upsert ImportBatch & Manifest (userCertified=false)`);
      console.log(`[Dry Run] Would upsert ForecastCheckpoint (isBankCoverageVerified=false)`);
      console.log(`[Dry Run] Would upsert EvaluationJob & Trigger`);
      return;
    }

    await prisma.$transaction(async (tx) => {
      // 1. Company
      await tx.company.upsert({
        where: { id: companyId },
        update: { clerkOrgId },
        create: {
          id: companyId,
          name: "Preview Synthetic Company",
          clerkOrgId,
          isDemo: true,
          onboardingCompleted: true,
        },
      });

      // 2. CashSnapshot
      await tx.cashSnapshot.upsert({
        where: { id: snapshotId },
        update: { bankBalance: 50000, asOfDate },
        create: {
          id: snapshotId,
          companyId,
          asOfDate,
          bankBalance: 50000,
        },
      });

      // 3. Bank Accounts
      await tx.bankAccount.upsert({
        where: { id: checkingAccountId },
        update: { name: "Preview Synthetic Checking Account", isActive: true },
        create: {
          id: checkingAccountId,
          companyId,
          name: "Preview Synthetic Checking Account",
          isActive: true,
        },
      });

      await tx.bankAccount.upsert({
        where: { id: syntheticAccountId },
        update: { name: "Synthetic Preview Account", isActive: true },
        create: {
          id: syntheticAccountId,
          companyId,
          name: "Synthetic Preview Account",
          isActive: true,
        },
      });

      // 4. Bank Transactions
      await tx.bankTransaction.upsert({
        where: { id: txInflowId },
        update: { amount: 1000, description: "Synthetic Inflow Test", txDate: currentWeekStart },
        create: {
          id: txInflowId,
          companyId,
          accountId: checkingAccountId,
          txDate: currentWeekStart,
          amount: 1000,
          description: "Synthetic Inflow Test",
          direction: "inflow",
          txHash: "hash-inflow-test",
          internalTransferStatus: "unresolved",
        },
      });

      await tx.bankTransaction.upsert({
        where: { id: txOutflowId },
        update: { amount: -500, description: "Synthetic Outflow Test", txDate: currentWeekStart },
        create: {
          id: txOutflowId,
          companyId,
          accountId: checkingAccountId,
          txDate: currentWeekStart,
          amount: -500,
          description: "Synthetic Outflow Test",
          direction: "outflow",
          txHash: "hash-outflow-test",
          internalTransferStatus: "unresolved",
        },
      });

      await tx.bankTransaction.upsert({
        where: { id: txTransferInId },
        update: { amount: 200, description: "Internal Transfer In", txDate: currentWeekStart, internalTransferStatus: "unresolved" },
        create: {
          id: txTransferInId,
          companyId,
          accountId: syntheticAccountId,
          txDate: currentWeekStart,
          amount: 200,
          description: "Internal Transfer In",
          direction: "inflow",
          txHash: "hash-transfer-in",
          internalTransferStatus: "unresolved",
        },
      });

      await tx.bankTransaction.upsert({
        where: { id: txTransferOutId },
        update: { amount: -200, description: "Internal Transfer Out", txDate: currentWeekStart, internalTransferStatus: "unresolved" },
        create: {
          id: txTransferOutId,
          companyId,
          accountId: checkingAccountId,
          txDate: currentWeekStart,
          amount: -200,
          description: "Internal Transfer Out",
          direction: "outflow",
          txHash: "hash-transfer-out",
          internalTransferStatus: "unresolved",
        },
      });

      // 5. ImportBatch & Manifest
      await tx.importBatch.upsert({
        where: { id: importBatchId },
        update: { rowCount: 4, status: "success" },
        create: {
          id: importBatchId,
          companyId,
          importType: "bank_statement",
          filename: "synthetic-preview.csv",
          rowCount: 4,
          status: "success",
        },
      });

      await tx.bankImportManifest.upsert({
        where: { id: manifestId },
        update: { userCertified: false },
        create: {
          id: manifestId,
          companyId,
          userCertified: false,
        },
      });

      // 6. ForecastCheckpoint
      const weekEnd = new Date(currentWeekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      await tx.forecastCheckpoint.upsert({
        where: { id: checkpointId },
        update: { isBankCoverageVerified: false },
        create: {
          id: checkpointId,
          companyId,
          cashSnapshotId: snapshotId,
          weekStart: currentWeekStart,
          weekEnd,
          endCashExpected: 50000,
          inflowsExpected: 1000,
          outflowsExpected: -500,
          isBankCoverageVerified: false,
        },
      });

      // 7. Evaluation Job
      await tx.evaluationJob.upsert({
        where: { id: evalJobId },
        update: { status: "completed" },
        create: {
          id: evalJobId,
          companyId,
          status: "completed",
        }
      });

      await tx.evaluationJobTrigger.upsert({
        where: { id: triggerId },
        update: {},
        create: {
          id: triggerId,
          companyId,
          evaluationJobId: evalJobId,
          source: "bank_upload",
          sourceId: importBatchId,
        }
      });

      console.log("Successfully seeded deterministic preview data.");
    });
  } catch (e) {
    console.error("Seed failed:", e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
