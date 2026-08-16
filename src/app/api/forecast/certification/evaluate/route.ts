export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { resolveTenant } from "@/lib/tenant";
import {
    evaluateForecastRisk,
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
        if (!body.forecastCheckpointId || !body.stressInputs) {
            return NextResponse.json(
                { error: "Missing required fields: forecastCheckpointId, stressInputs" },
                { status: 400 }
            );
        }

        const review = await evaluateForecastRisk(
            companyId,
            body.forecastCheckpointId,
            body.stressInputs
        );
        return NextResponse.json({ review });
    } catch (error: unknown) {
        const status = error instanceof ForecastGovernanceError
            ? error.httpStatus
            : error instanceof StressInputValidationError
                ? 400
                : 500;
        if (status === 500) console.error("Forecast risk evaluation error:", error);
        return NextResponse.json({ error: errorMessage(error) }, { status });
    }
}
