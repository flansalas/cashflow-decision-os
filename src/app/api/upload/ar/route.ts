// POST /api/upload/ar
// Upserts ReceivableInvoice rows, saves MappingProfile, records ar_refresh_at timestamp.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

interface NormalizedARRow {
    customerName: string;
    invoiceNo: string;
    amountOpen: number;
    invoiceDate: string | null;
    dueDate: string | null;
    status: string;
    daysPastDue: number | null;
}

export async function POST(req: NextRequest) {
    const { companyId, rows, mappingJson } = await req.json() as {
        companyId: string;
        rows: NormalizedARRow[];
        mappingJson: Record<string, string>;
    };

    if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    if (!rows?.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });

    let imported = 0;
    let updated = 0;
    const processedIds: string[] = [];

    try {
        // Upsert each row by natural key (companyId + invoiceNo + customerName)
        for (const row of rows) {
            const existing = await prisma.receivableInvoice.findFirst({
                where: {
                    companyId,
                    invoiceNo: row.invoiceNo,
                    customerName: row.customerName,
                },
            });

            const data = {
                customerName: row.customerName,
                invoiceNo: row.invoiceNo,
                amountOpen: row.amountOpen,
                invoiceDate: row.invoiceDate ? new Date(row.invoiceDate) : null,
                dueDate: row.dueDate ? new Date(row.dueDate) : null,
                status: row.status || "open",
                daysPastDue: row.daysPastDue ?? null,
            };

            if (existing) {
                const updatedRecord = await prisma.receivableInvoice.update({
                    where: { id: existing.id },
                    data,
                });
                processedIds.push(updatedRecord.id);
                updated++;
            } else {
                const newRecord = await prisma.receivableInvoice.create({
                    data: { companyId, ...data },
                });
                processedIds.push(newRecord.id);
                imported++;
            }
        }

        // Delete rows that were not in this upload
        const deleteResult = await prisma.receivableInvoice.deleteMany({
            where: {
                companyId,
                id: { notIn: processedIds },
            },
        });
        const deleted = deleteResult.count;

        // Persist mapping profile
        await prisma.mappingProfile.upsert({
            where: { companyId_kind: { companyId, kind: "ar" } },
            update: { mappingJson: JSON.stringify(mappingJson) },
            create: { companyId, kind: "ar", mappingJson: JSON.stringify(mappingJson) },
        });

        // Record refresh timestamp
        const key = "ar_refresh_at";
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
        console.error("AR upload error:", error);
        return NextResponse.json({ error: "Failed to import AR data" }, { status: 500 });
    }
}
