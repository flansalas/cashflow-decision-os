export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";
import { certifyForecastVersion } from "@/services/forecast-certification";

export async function POST(req: NextRequest) {
    try {
        const tenantId = await resolveTenant(req);
        if (!tenantId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const authResult = await auth();
        const userId = authResult?.userId;
        
        if (!userId) {
            return NextResponse.json({ error: "Authenticated identity required for certification" }, { status: 401 });
        }

        const body = await req.json();
        const { forecastCheckpointId, status, rationale, bufferRationale, stressInputs } = body;

        if (!forecastCheckpointId || !status || !stressInputs) {
            return NextResponse.json({ error: "Missing required fields: forecastCheckpointId, status, stressInputs" }, { status: 400 });
        }
        
        if (status !== 'certified' && status !== 'not_safe') {
            return NextResponse.json({ error: "Status must be certified or not_safe" }, { status: 400 });
        }

        const certification = await certifyForecastVersion(
            tenantId,
            forecastCheckpointId,
            { status, decidedBy: userId, rationale },
            stressInputs,
            bufferRationale
        );
        
        // Log deliberate action in ChangeLog
        await prisma.changeLog.create({
            data: {
                companyId: tenantId,
                source: 'ForecastVersionCertification',
                action: status === 'certified' ? 'CERTIFIED' : 'NOT_SAFE',
                inputText: forecastCheckpointId,
                timestamp: new Date(),
                userId: userId,
                forecastVersionHashAfter: certification.forecastVersionHash,
                diffJson: JSON.stringify({
                    status,
                    rationale,
                    bufferRationale,
                    certificationId: certification.id
                })
            }
        });

        return NextResponse.json({ success: true, certification });
    } catch (e: any) {
        console.error("Forecast Certification POST Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
