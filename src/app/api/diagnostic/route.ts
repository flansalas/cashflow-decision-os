import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function GET() {
    const { userId, orgId } = auth();

    const dbUrl = process.env.DATABASE_URL || "";
    let dbHost = "unknown";
    try {
        if (dbUrl) {
            const url = new URL(dbUrl);
            dbHost = url.hostname;
        }
    } catch (e) {
        dbHost = "invalid_url";
    }

    const clerkPK = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
    const clerkSK = process.env.CLERK_SECRET_KEY || "";

    return NextResponse.json({
        userId,
        orgId,
        vercelProject: process.env.VERCEL_PROJECT_ID || process.env.VERCEL_GIT_REPO_SLUG,
        dbHost,
        clerkPkPrefix: clerkPK.substring(0, 15),
        clerkSkPrefix: clerkSK.substring(0, 15),
        clerkEnvType: clerkPK.includes("dev") || clerkPK.includes("test") ? "Development/Test" : "Production",
        vercelEnv: process.env.VERCEL_ENV,
    });
}
