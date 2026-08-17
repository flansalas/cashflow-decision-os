import { NextRequest, NextResponse } from "next/server";
import { evaluateMaturedCheckpoints } from "@/services/canonical-evaluator";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export const dynamic = 'force-dynamic';

// Simple in-memory concurrency guard for the evaluator
const evaluationLocks = new Set<string>();

export async function POST(req: NextRequest) {
    let lockKey: string | null = null;
    let lockAcquired = false;
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const companyId = await resolveTenant(req);
        if (!companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json().catch(() => ({}));
        if (body.companyId !== undefined && body.companyId !== companyId) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        lockKey = companyId;
        if (evaluationLocks.has(lockKey)) {
            return NextResponse.json({ ok: false, message: "Evaluation already in progress for this company" }, { status: 409 });
        }
        evaluationLocks.add(lockKey);
        lockAcquired = true;

        const evaluation = await evaluateMaturedCheckpoints(companyId);

        await prisma.changeLog.create({
            data: {
                companyId,
                source: "evaluate-horizons",
                action: "manual_trigger",
                inputText: "Manually triggered canonical evaluator",
                diffJson: JSON.stringify({ userId, evaluation }),
                forecastVersionHashAfter: "n/a"
            }
        });

        return NextResponse.json({
            ok: true,
            message: "Evaluated matured horizons successfully",
            evaluation
        });
    } catch (err: unknown) {
        console.error("Evaluation trigger error:", err);
        return NextResponse.json({ error: (err as Error).message ?? "Internal error" }, { status: 500 });
    } finally {
        if (lockAcquired && lockKey) evaluationLocks.delete(lockKey);
    }
}
