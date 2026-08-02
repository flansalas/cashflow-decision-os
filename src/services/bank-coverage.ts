import prisma from "@/db/prisma";

export interface BankCoverageEvidence {
  isVerified: boolean;
  totalActiveAccounts: number;
  coveredAccounts: number;
  uncoveredAccountIds: string[];
  reasons: string[];
}

export async function verifyBankCoverage(
  companyId: string,
  weekStart: Date,
  weekEnd: Date
): Promise<BankCoverageEvidence> {
  const activeAccounts = await prisma.bankAccount.findMany({
    where: {
      companyId,
      isActive: true,
    },
  });

  if (activeAccounts.length === 0) {
    return {
      isVerified: false,
      totalActiveAccounts: 0,
      coveredAccounts: 0,
      uncoveredAccountIds: [],
      reasons: ["No active bank accounts found for the company."],
    };
  }

  const uncoveredAccountIds: string[] = [];
  const reasons: string[] = [];
  let coveredAccounts = 0;

  for (const account of activeAccounts) {
    const coverage = await prisma.bankImportManifestAccount.findFirst({
      where: {
        bankAccountId: account.id,
        coveredStartDate: { lte: weekStart },
        coveredEndDate: { gte: weekEnd },
        importSuccess: true,
        rejectedRowCount: 0,
        BankImportManifest: {
            userCertified: true,
            companyId: companyId,
        },
        userCertifiedAt: { not: null },
      },
    });

    if (coverage) {
      coveredAccounts++;
    } else {
      uncoveredAccountIds.push(account.id);
      reasons.push(`Account ${account.id} lacks complete, certified coverage for the week ending ${weekEnd.toISOString().split('T')[0]}.`);
    }
  }

  const isVerified = uncoveredAccountIds.length === 0;

  return {
    isVerified,
    totalActiveAccounts: activeAccounts.length,
    coveredAccounts,
    uncoveredAccountIds,
    reasons,
  };
}
