// POST /api/upload/ap
// Upserts PayableBill rows, saves MappingProfile, records ap_refresh_at timestamp.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

interface NormalizedAPRow {
    vendorName: string;
    billNo: string;
    amountOpen: number;
    billDate: string | null;
    dueDate: string | null;
    status: string;
    daysPastDue: number | null;
}

export async function POST(req: NextRequest) {
    const { companyId, rows, mappingJson } = await req.json() as {
        companyId: string;
        rows: NormalizedAPRow[];
        mappingJson: Record<string, string>;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!rows?.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });

    let imported = 0;
    let updated = 0;
    const processedIds: string[] = [];

    try {
        // Upsert each row by natural key (companyId + billNo + vendorName)
        for (const row of rows) {
            const existing = await prisma.payableBill.findFirst({
                where: {
                    companyId,
                    billNo: row.billNo,
                    vendorName: row.vendorName,
                },
            });

            const data = {
                vendorName: row.vendorName,
                billNo: row.billNo,
                amountOpen: row.amountOpen,
                billDate: row.billDate ? new Date(row.billDate) : null,
                dueDate: row.dueDate ? new Date(row.dueDate) : null,
                status: row.status || "open",
                daysPastDue: row.daysPastDue ?? null,
            };

            if (existing) {
                const updatedRecord = await prisma.payableBill.update({
                    where: { id: existing.id },
                    data,
                });
                processedIds.push(updatedRecord.id);
                updated++;
            } else {
                const newRecord = await prisma.payableBill.create({
                    data: { companyId, ...data },
                });
                processedIds.push(newRecord.id);
                imported++;
            }
        }

        // Delete rows that were not in this upload
        const deleteResult = await prisma.payableBill.deleteMany({
            where: {
                companyId,
                id: { notIn: processedIds },
            },
        });
        const deleted = deleteResult.count;

        // Persist mapping profile
        await prisma.mappingProfile.upsert({
            where: { companyId_kind: { companyId, kind: "ap" } },
            update: { mappingJson: JSON.stringify(mappingJson) },
            create: { companyId, kind: "ap", mappingJson: JSON.stringify(mappingJson) },
        });

        // Record refresh timestamp
        const key = "ap_refresh_at";
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
            updated,
            deleted,
            total: imported + updated
        });
    } catch (error) {
        console.error("AP upload error:", error);
        return NextResponse.json({ error: "Failed to import AP data" }, { status: 500 });
    }
}
