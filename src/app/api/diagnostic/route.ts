import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";

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
    const tenant = await resolveTenant();
    mappedCompanyId = tenant.companyId;
    mappedClerkOrgId = tenant.clerkOrgId;
    companyName = tenant.companyName;
  } catch (e: any) {
    // resolveTenant throws if no matching company is found for the orgId
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
