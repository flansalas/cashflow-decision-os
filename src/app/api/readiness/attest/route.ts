import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { 
    computeARPopulationHash, 
    computeAPPopulationHash, 
    computeRecurringPopulationHash 
} from "@/services/data-readiness-evaluation";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { companyId, scopeType, scopeKey, asOfDate, controlCount, controlAmount, evidenceJson, certifiedBy } = body;

        if (!companyId || !scopeType || !asOfDate || !evidenceJson || !certifiedBy) {
            return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const company = await prisma.company.findUnique({
            where: { id: companyId }
        });

        if (!company) {
            return NextResponse.json({ error: "Company not found" }, { status: 404 });
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
                certifiedBy,
                status: 'active'
            }
        });

        return NextResponse.json(attestation, { status: 201 });
    } catch (e: any) {
        console.error("Error creating data readiness attestation:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
