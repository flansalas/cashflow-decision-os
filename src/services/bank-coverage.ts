import prisma from "@/db/prisma";

export interface BankCoverageEvidence {
  isVerified: boolean;
  totalActiveAccounts: number;
  coveredAccounts: number;
  uncoveredAccountIds: string[];
  reasons: string[];
}

type CoverageInterval = {
  start: Date;
  end: Date;
};

function validInterval(start: Date | null, end: Date | null): CoverageInterval | null {
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return null;
  }

  return { start, end };
}

function manifestInterval(start: Date | null, end: Date | null): CoverageInterval | null {
  const interval = validInterval(start, end);
  if (!interval) return null;

  const coveredStart = new Date(interval.start);
  coveredStart.setUTCHours(0, 0, 0, 0);
  const coveredEnd = new Date(interval.end);
  coveredEnd.setUTCHours(23, 59, 59, 999);

  return { start: coveredStart, end: coveredEnd };
}

function coversRequestedInterval(
  intervals: CoverageInterval[],
  requiredStart: Date,
  requiredEnd: Date
): boolean {
  const sorted = intervals
    .map(interval => ({
      start: new Date(Math.max(interval.start.getTime(), requiredStart.getTime())),
      end: new Date(Math.min(interval.end.getTime(), requiredEnd.getTime())),
    }))
    .filter(interval => interval.start <= interval.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (sorted.length === 0 || sorted[0].start > requiredStart) return false;

  let coveredThrough = sorted[0].end.getTime();
  for (const interval of sorted.slice(1)) {
    if (interval.start.getTime() > coveredThrough + 1) break;
    coveredThrough = Math.max(coveredThrough, interval.end.getTime());
  }

  return coveredThrough >= requiredEnd.getTime();
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
    const certifiedManifestAccounts = await prisma.bankImportManifestAccount.findMany({
      where: {
        bankAccountId: account.id,
        importSuccess: true,
        rejectedRowCount: 0,
        BankImportManifest: {
          userCertified: true,
          companyId,
        },
        userCertifiedAt: { not: null },
      },
      select: {
        coveredStartDate: true,
        coveredEndDate: true,
      },
    });

    const intervals: CoverageInterval[] = certifiedManifestAccounts
      .map(coverage => manifestInterval(coverage.coveredStartDate, coverage.coveredEndDate))
      .filter((coverage): coverage is CoverageInterval => coverage !== null);

    const noActivityAttestations = await prisma.dataReadinessAttestation.findMany({
      where: {
        companyId,
        scopeType: "bank_no_activity",
        scopeKey: account.id,
        status: "active",
      },
      select: { evidenceJson: true },
    });

    for (const attestation of noActivityAttestations) {
      try {
        const evidence = JSON.parse(attestation.evidenceJson) as {
          coveredStartDate?: string;
          coveredEndDate?: string;
        };
        const interval = validInterval(
          evidence.coveredStartDate ? new Date(evidence.coveredStartDate) : null,
          evidence.coveredEndDate ? new Date(evidence.coveredEndDate) : null
        );
        if (!interval) continue;

        const transactionInClaimedGap = await prisma.bankTransaction.findFirst({
          where: {
            companyId,
            accountId: account.id,
            txDate: { gte: interval.start, lte: interval.end },
          },
          select: { id: true },
        });

        if (!transactionInClaimedGap) intervals.push(interval);
      } catch {
        // Invalid evidence is ignored and cannot contribute coverage.
      }
    }

    if (coversRequestedInterval(intervals, weekStart, weekEnd)) {
      coveredAccounts++;
    } else {
      uncoveredAccountIds.push(account.id);
      reasons.push(`Account ${account.id} lacks continuous, certified coverage from ${weekStart.toISOString()} through ${weekEnd.toISOString()}.`);
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
