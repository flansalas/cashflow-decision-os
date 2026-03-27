// POST /api/upload/bank
// Replace BankTransaction rows, save MappingProfile, record bank_refresh_at

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

interface NormalizedBankRow {
    date: string | null;
    description: string;
    amount: number;
}

export async function POST(req: NextRequest) {
    const { companyId, rows, mappingJson } = await req.json() as {
        companyId: string;
        rows: NormalizedBankRow[];
        mappingJson: Record<string, string>;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!rows?.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });

    try {
        // Simple strategy: delete existing bank tx for company and replace
        await prisma.bankTransaction.deleteMany({ where: { companyId } });

        const txData = rows.map((row) => ({
            companyId,
            txDate: new Date(row.date!),
            amount: Math.abs(row.amount),
            description: row.description,
            direction: row.amount > 0 ? "inflow" : "outflow",
        }));

        await prisma.bankTransaction.createMany({
            data: txData,
        });

        const imported = txData.length;

        // Persist mapping
        await prisma.mappingProfile.upsert({
            where: { companyId_kind: { companyId, kind: "bank" } },
            update: { mappingJson: JSON.stringify(mappingJson) },
            create: { companyId, kind: "bank", mappingJson: JSON.stringify(mappingJson) },
        });

        // Record timestamp
        const key = "bank_refresh_at";
        const noteText = `${key}:${new Date().toISOString()}`;
        const existingNote = await prisma.companyNote.findFirst({
            where: { companyId, noteText: { startsWith: `${key}:` } },
        });
        if (existingNote) {
            await prisma.companyNote.update({ where: { id: existingNote.id }, data: { noteText } });
        } else {
            await prisma.companyNote.create({ data: { companyId, noteText } });
        }

        return NextResponse.json({
            ok: true,
            imported,
            updated: 0,
            deleted: 0,
            total: imported
        });
    } catch (error) {
        console.error("Bank upload error:", error);
        return NextResponse.json({ error: "Failed to import Bank data" }, { status: 500 });
    }
}
