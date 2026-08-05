import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import prisma from "@/db/prisma";

export async function GET(req: Request) {
  const session = await auth();

  let dbHost = "unknown";
  try {
    if (process.env.DATABASE_URL) {
      dbHost = new URL(process.env.DATABASE_URL).hostname;
    }
  } catch (e) {}

  const url = new URL(req.url);
  const doUpdate = url.searchParams.get("update") === "true";

  const syntheticId = "bb32d2cf-b0a6-4e1d-bcfa-d2004a711bfb";
  const activeOrgId = "org_3C5Tfg6SPRflDHu2cLuR3IfsuAR";
  const staleOrgId = "org_3CK3tdHaQYLWO10gwk5cMVVlk99";

  const diagnosticResults: any = {
    userId: session.userId,
    orgId: session.orgId,
    databaseHostname: dbHost,
    vercelEnvironment: process.env.VERCEL_ENV || "unknown",
    deploymentCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
  };

  try {
    // Current runtime resolution
    let mappedCompanyId: string | null = null;
    let mappedClerkOrgId: string | null = null;
    try {
      const tenantId = await resolveTenant();
      if (tenantId) {
        mappedCompanyId = tenantId;
        const c = await prisma.company.findUnique({ where: { id: tenantId } });
        if (c) {
          mappedClerkOrgId = c.clerkOrgId;
        }
      }
    } catch (e: any) {
      mappedCompanyId = `Error: ${e.message}`;
    }
    diagnosticResults.runtimeResolution = {
      mappedCompanyId,
      mappedClerkOrgId,
    };

    // Read-only queries for diagnosis
    const companyBySyntheticId = await prisma.company.findUnique({
      where: { id: syntheticId },
    });
    
    const companyByActiveOrg = await prisma.company.findFirst({
      where: { clerkOrgId: activeOrgId },
    });

    const companyByStaleOrg = await prisma.company.findFirst({
      where: { clerkOrgId: staleOrgId },
    });

    diagnosticResults.beforeMutation = {
      companyBySyntheticId,
      companyByActiveOrg,
      companyByStaleOrg,
    };

    // Mutation if requested
    if (doUpdate) {
      diagnosticResults.mutationLog = [];
      if (companyBySyntheticId && companyBySyntheticId.clerkOrgId === staleOrgId) {
        if (!companyByActiveOrg) {
          const updated = await prisma.company.update({
            where: {
              id: syntheticId,
              clerkOrgId: staleOrgId, // assertion
            },
            data: {
              clerkOrgId: activeOrgId,
            }
          });
          diagnosticResults.mutationLog.push(`Successfully updated company ${syntheticId} to ${activeOrgId}`);
          diagnosticResults.afterMutation = {
            updatedCompany: updated
          };
        } else {
          diagnosticResults.mutationLog.push(`Aborted: Another company already uses active org ${activeOrgId}`);
        }
      } else if (companyBySyntheticId && companyBySyntheticId.clerkOrgId !== staleOrgId) {
         diagnosticResults.mutationLog.push(`Aborted: Synthetic company has unexpected clerkOrgId ${companyBySyntheticId.clerkOrgId}`);
      } else if (!companyBySyntheticId) {
         diagnosticResults.mutationLog.push(`Aborted: Synthetic company not found.`);
      }
    }

  } catch (e: any) {
    diagnosticResults.error = e.message;
  }

  return NextResponse.json(diagnosticResults);
}
