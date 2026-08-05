import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import prisma from "@/db/prisma";

export async function GET() {
  const session = await auth();

  let dbHost = "unknown";
  try {
    if (process.env.DATABASE_URL) {
      dbHost = new URL(process.env.DATABASE_URL).hostname;
    }
  } catch (e) {}

  let mappedCompanyId = null;
  let mappedClerkOrgId = null;
  let companyName = null;

  try {
    const tenantId = await resolveTenant();
    if (tenantId) {
      mappedCompanyId = tenantId;
      const company = await prisma.company.findUnique({
        where: { id: tenantId }
      });
      if (company) {
        mappedClerkOrgId = company.clerkOrgId;
        companyName = company.name;
      }
    } else {
       mappedCompanyId = "No match (null)";
    }
  } catch (e: any) {
    mappedCompanyId = `Error: ${e.message}`;
  }

  return NextResponse.json({
    userId: session.userId,
    orgId: session.orgId,
    mappedCompanyId,
    mappedClerkOrgId,
    companyName,
    databaseHostname: dbHost,
    vercelEnvironment: process.env.VERCEL_ENV || "unknown",
    deploymentCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
  });
}
