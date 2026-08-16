import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";
import { 
    computeARPopulationHash, 
    computeAPPopulationHash, 
    computeRecurringPopulationHash 
} from "@/services/data-readiness-evaluation";

export async function POST(req: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const companyId = await resolveTenant(req);
        if (!companyId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const {
            companyId: requestedCompanyId,
            scopeType,
            scopeKey,
            asOfDate,
            controlCount,
            controlAmount,
            evidenceJson
        } = body;

        if (requestedCompanyId !== undefined && requestedCompanyId !== companyId) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        if (!scopeType || !asOfDate || !evidenceJson) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        let sourceStateHash = '';
        
        if (scopeType === 'ar') {
            sourceStateHash = await computeARPopulationHash(companyId);
        } else if (scopeType === 'ap') {
            sourceStateHash = await computeAPPopulationHash(companyId);
        } else if (scopeType === 'recurring') {
            sourceStateHash = await computeRecurringPopulationHash(companyId);
        } else if (scopeType === 'bank_no_activity') {
            if (!scopeKey) {
                return NextResponse.json({ error: "scopeKey (bankAccountId) is required for bank_no_activity" }, { status: 400 });
            }
            let interval: { coveredStartDate?: string; coveredEndDate?: string };
            try {
                interval = JSON.parse(evidenceJson);
            } catch {
                return NextResponse.json({ error: "bank_no_activity evidence must be valid JSON" }, { status: 400 });
            }
            const coveredStartDate = new Date(interval.coveredStartDate || '');
            const coveredEndDate = new Date(interval.coveredEndDate || '');
            if (
                !interval.coveredStartDate ||
                !interval.coveredEndDate ||
                isNaN(coveredStartDate.getTime()) ||
                isNaN(coveredEndDate.getTime()) ||
                coveredStartDate > coveredEndDate
            ) {
                return NextResponse.json({ error: "bank_no_activity requires a valid coveredStartDate and coveredEndDate" }, { status: 400 });
            }
            const bankAccount = await prisma.bankAccount.findFirst({
                where: { id: scopeKey, companyId },
                select: { id: true }
            });
            if (!bankAccount) {
                return NextResponse.json({ error: "Forbidden" }, { status: 403 });
            }
            // For bank no activity, the "source state" is just the interval which is captured in evidence
            // We can hash the evidence to create a deterministic hash
            sourceStateHash = Buffer.from(evidenceJson).toString('base64');
        } else {
            return NextResponse.json({ error: "Invalid scopeType" }, { status: 400 });
        }

        // Invalidate previous active attestations for this scope
        const scopeFilter: any = { companyId, scopeType, status: 'active' };
        if (scopeKey) scopeFilter.scopeKey = scopeKey;

        await prisma.dataReadinessAttestation.updateMany({
            where: scopeFilter,
            data: { status: 'revoked', revokedAt: new Date() }
        });

        const attestation = await prisma.dataReadinessAttestation.create({
            data: {
                companyId,
                scopeType,
                scopeKey: scopeKey || null,
                asOfDate: new Date(asOfDate),
                controlCount: controlCount || null,
                controlAmount: controlAmount || null,
                sourceStateHash,
                evidenceJson,
                certifiedBy: userId,
                status: 'active'
            }
        });

        return NextResponse.json(attestation, { status: 201 });
    } catch (e: any) {
        console.error("Error creating data readiness attestation:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
