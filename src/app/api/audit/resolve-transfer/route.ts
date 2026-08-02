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
        const { txId1, txId2, companyId } = body;

        // Verify company access
        const company = await prisma.company.findUnique({
            where: { id: companyId }
        });
        if (!company) {
            return NextResponse.json({ error: "Company not found" }, { status: 404 });
        }
        if (orgId && company.clerkOrgId && orgId !== company.clerkOrgId) {
            return NextResponse.json({ error: "Unauthorized for company" }, { status: 403 });
        }
        if (txId1 === txId2) {
            return NextResponse.json({ error: "Cannot pair a transaction with itself" }, { status: 400 });
        }

        const result = await prisma.$transaction(async (tx) => {
            // Lock both rows to prevent concurrent pairings
            const txs = await tx.$queryRaw<any[]>`
                SELECT * FROM "BankTransaction" 
                WHERE id IN (${txId1}, ${txId2}) 
                AND "companyId" = ${companyId}
                FOR UPDATE
            `;

            if (txs.length !== 2) {
                throw new Error("One or both transactions not found or do not belong to company");
            }

            const t1 = txs.find(t => t.id === txId1);
            const t2 = txs.find(t => t.id === txId2);

            // Idempotency: if they are already paired together and confirmed, return existing
            if (t1.internalTransferPairId && t1.internalTransferPairId === t2.internalTransferPairId && t1.internalTransferStatus === 'confirmed' && t2.internalTransferStatus === 'confirmed') {
                return { success: true, pairId: t1.internalTransferPairId, idempotent: true };
            }

            // Validation
            if (t1.accountId === t2.accountId) {
                throw new Error("Transfers must be between different accounts");
            }
            if (Math.abs(t1.amount + t2.amount) > 0.01) {
                throw new Error("Amounts are not equal and opposite");
            }

            // Ensure no OTHER active pairing
            if (t1.internalTransferPairId || t2.internalTransferPairId || t1.internalTransferStatus === 'confirmed' || t2.internalTransferStatus === 'confirmed') {
                throw new Error("One or both transactions are already paired");
            }

            const pairId = `pair_${Date.now()}_${Math.random().toString(36).substring(7)}`;

            await tx.bankTransaction.update({
                where: { id: txId1 },
                data: { internalTransferStatus: 'confirmed', internalTransferPairId: pairId }
            });

            await tx.bankTransaction.update({
                where: { id: txId2 },
                data: { internalTransferStatus: 'confirmed', internalTransferPairId: pairId }
            });

            await tx.internalTransferHistory.create({
                data: {
                    companyId,
                    pairId,
                    txId1,
                    txId2,
                    pairedByUserId: userId,
                    evidenceJson: JSON.stringify({ amount: t1.amount, txId1, txId2 })
                }
            });

            await tx.changeLog.create({
                data: {
                    companyId,
                    source: "resolve-transfer",
                    action: "confirm_transfer",
                    inputText: `Confirmed internal transfer between ${txId1} and ${txId2}`,
                    diffJson: JSON.stringify({ pairId, txId1, txId2, amount: t1.amount, confirmer: userId }),
                    forecastVersionHashAfter: "n/a"
                }
            });

            await triggerEvaluation(companyId, 'transfer_paired', pairId, tx);

            return { success: true, pairId, idempotent: false };
        });

        return NextResponse.json(result);
    } catch (e: any) {
        console.error("Transfer resolution error:", e);
        return NextResponse.json({ error: e.message }, { status: 400 });
    }
}
