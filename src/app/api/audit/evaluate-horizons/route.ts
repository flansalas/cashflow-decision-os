import { NextRequest, NextResponse } from "next/server";
import { evaluateMaturedCheckpoints } from "@/services/canonical-evaluator";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

export const dynamic = 'force-dynamic';

// Simple in-memory concurrency guard for the evaluator
const evaluationLocks = new Set<string>();

export async function POST(req: NextRequest) {
    let lockKey = "global";
    try {
        const { userId, orgId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        const companyId = body.companyId as string;

        if (!companyId) {
            return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
        }

        lockKey = companyId;
        if (evaluationLocks.has(lockKey)) {
            return NextResponse.json({ ok: false, message: "Evaluation already in progress for this company" }, { status: 409 });
        }
        evaluationLocks.add(lockKey);

        const company = await prisma.company.findUnique({ where: { id: companyId } });
        if (!company) {
            return NextResponse.json({ error: "Company not found" }, { status: 404 });
        }
        
        if (orgId && company.clerkOrgId && orgId !== company.clerkOrgId) {
            return NextResponse.json({ error: "Unauthorized for company" }, { status: 403 });
        }

        await evaluateMaturedCheckpoints(companyId);

        // Audit Log
        await prisma.changeLog.create({
            data: {
                companyId,
                source: "evaluate-horizons",
                action: "manual_trigger",
                inputText: "Manually triggered canonical evaluator",
                diffJson: JSON.stringify({ userId }),
                forecastVersionHashAfter: "n/a"
            }
        });

        return NextResponse.json({ ok: true, message: "Evaluated matured horizons successfully" });
    } catch (err: unknown) {
        console.error("Evaluation trigger error:", err);
        return NextResponse.json({ error: (err as Error).message ?? "Internal error" }, { status: 500 });
    } finally {
        evaluationLocks.delete(lockKey);
    }
}
