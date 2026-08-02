// GET /api/upload/bank/status
// Returns count of BankTransaction rows for a company within an optional date range.
// Used by the weekly roll ritual preview to verify actual bank data presence
// for the week being closed — not local UI state.
// No DB writes. No schema change. Generic for any company.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { verifyBankCoverage } from "@/services/bank-coverage";

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const companyId = searchParams.get("companyId");
    const weekStart = searchParams.get("weekStart");
    const weekEnd = searchParams.get("weekEnd");

    if (!companyId) {
        return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    }

    try {
        const rowCount = await prisma.bankTransaction.count({
            where: {
                companyId,
                ...(weekStart && weekEnd
                    ? { txDate: { gte: new Date(weekStart), lte: new Date(weekEnd) } }
                    : {}),
            },
        });

        let isVerified = false;
        let coverageDetails = null;

        if (weekStart && weekEnd) {
            coverageDetails = await verifyBankCoverage(companyId, new Date(weekStart), new Date(weekEnd));
            isVerified = coverageDetails.isVerified;
        }

        return NextResponse.json({
            hasData: rowCount > 0,
            rowCount,
            isVerified,
            coverageDetails,
            weekStart: weekStart ?? null,
            weekEnd: weekEnd ?? null,
        });
    } catch (error) {
        console.error("Bank status check error:", error);
        return NextResponse.json({ error: "Failed to check bank data status" }, { status: 500 });
    }
}
