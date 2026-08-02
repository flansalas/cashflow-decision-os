import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { triggerEvaluation } from "@/services/evaluation-job-worker";

export async function POST(req: NextRequest) {
    try {
        const { userId, orgId } = await auth();
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { pairId, companyId } = body;

        const company = await prisma.company.findUnique({ where: { id: companyId } });
        if (!company) {
            return NextResponse.json({ error: "Company not found" }, { status: 404 });
        }
        if (orgId && company.clerkOrgId && orgId !== company.clerkOrgId) {
            return NextResponse.json({ error: "Unauthorized for company" }, { status: 403 });
        }

        const result = await prisma.$transaction(async (tx) => {
            // Find active history
            const history = await tx.internalTransferHistory.findFirst({
                where: { pairId, companyId, isActive: true }
            });

            if (!history) {
                // Idempotency check: if it's already unpaired (isActive: false), we just return success
                const inactiveHistory = await tx.internalTransferHistory.findFirst({
                    where: { pairId, companyId, isActive: false }
                });
                if (inactiveHistory) {
                    return { success: true, pairId, idempotent: true };
                }
                throw new Error("Active pair not found");
            }

            // Lock rows
            const txs = await tx.$queryRaw<any[]>`
                SELECT * FROM "BankTransaction" 
                WHERE id IN (${history.txId1}, ${history.txId2}) 
                AND "companyId" = ${companyId}
                FOR UPDATE
            `;

            if (txs.length !== 2) {
                throw new Error("Transactions for this pair are missing or invalid");
            }

            await tx.bankTransaction.update({
                where: { id: history.txId1 },
                data: { internalTransferStatus: 'unresolved', internalTransferPairId: null }
            });

            await tx.bankTransaction.update({
                where: { id: history.txId2 },
                data: { internalTransferStatus: 'unresolved', internalTransferPairId: null }
            });

            await tx.internalTransferHistory.update({
                where: { id: history.id },
                data: {
                    isActive: false,
                    unpairedByUserId: userId,
                    unpairedAt: new Date(),
                    unpairReason: "Manual unpair via API"
                }
            });

            await tx.changeLog.create({
                data: {
                    companyId,
                    source: "unresolve-transfer",
                    action: "unpair_transfer",
                    inputText: `Unpaired internal transfer ${pairId}`,
                    diffJson: JSON.stringify({ pairId, unpairer: userId }),
                    forecastVersionHashAfter: "n/a"
                }
            });

            await triggerEvaluation(companyId, 'transfer_unpaired', pairId, tx);

            return { success: true, pairId, idempotent: false };
        });

        return NextResponse.json(result);
    } catch (e: any) {
        console.error("Transfer unresolve error:", e);
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
