export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";
import {
    certifyForecastVersion,
    ForecastGovernanceError
} from "@/services/forecast-certification";
import { StressInputValidationError } from "@/services/forecast-scenario";

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Internal Server Error";
}

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const companyId = await resolveTenant(req);
        if (!companyId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        if (body.companyId !== undefined && body.companyId !== companyId) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const {
            forecastCheckpointId,
            status,
            rationale,
            bufferRationale,
            stressInputs,
            reviewedAuthority
        } = body;
        if (!forecastCheckpointId || !status || !stressInputs || !reviewedAuthority) {
            return NextResponse.json(
                { error: "Missing required fields: forecastCheckpointId, status, stressInputs, reviewedAuthority" },
                { status: 400 }
            );
        }
        if (status !== "certified" && status !== "not_safe") {
            return NextResponse.json({ error: "Status must be certified or not_safe" }, { status: 400 });
        }

        const certification = await prisma.$transaction(async tx => {
            const finalized = await certifyForecastVersion(
                companyId,
                forecastCheckpointId,
                { status, decidedBy: userId, rationale },
                stressInputs,
                bufferRationale,
                reviewedAuthority,
                tx
            );

            await tx.changeLog.create({
                data: {
                    companyId,
                    source: "ForecastVersionCertification",
                    action: finalized.status.toUpperCase(),
                    inputText: forecastCheckpointId,
                    timestamp: finalized.decidedAt || new Date(),
                    userId,
                    forecastVersionHashAfter: finalized.forecastVersionHash,
                    diffJson: JSON.stringify({
                        requestedStatus: status,
                        finalStatus: finalized.status,
                        rationale: rationale || null,
                        bufferRationale: bufferRationale || null,
                        certificationId: finalized.id
                    })
                }
            });

            return finalized;
        });

        return NextResponse.json({ success: true, certification });
    } catch (error: unknown) {
        const status = error instanceof ForecastGovernanceError
            ? error.httpStatus
            : error instanceof StressInputValidationError
                ? 400
                : 500;
        if (status === 500) console.error("Forecast Certification POST Error:", error);
        return NextResponse.json({ error: errorMessage(error) }, { status });
    }
}
