// POST /api/ingest/ap/upload
// Accepts multipart form-data (file + companyId).
// Parses server-side, returns: suggestedMapping, preview (10 rows), summary, allRows.

import { NextRequest, NextResponse } from "next/server";
import { parseBuffer } from "@/services/ingest/parseRows";
import { prepareAP, normalizeAPRows, apPreview, AP_FIELDS } from "@/services/ingest/ap";
import prisma from "@/db/prisma";

export async function POST(req: NextRequest) {
    try {
        const form = await req.formData();
        const file = form.get("file") as File | null;
        const companyId = form.get("companyId") as string | null;

        if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });
        if (!companyId) return NextResponse.json({ error: "Missing companyId" }, { status: 400 });

        const buf = Buffer.from(await file.arrayBuffer());
        const { headers, rows, rowCount } = parseBuffer(buf, file.name);

        const saved = await prisma.mappingProfile.findFirst({ where: { companyId, kind: "ap" } });
        const savedMapping = saved ? (JSON.parse(saved.mappingJson) as Record<string, string>) : null;

        const { mapping, savedMappingUsed } = prepareAP(headers, savedMapping);
        const normalized = normalizeAPRows(rows, mapping);
        const { preview, summary } = apPreview(normalized);

        return NextResponse.json({
            ok: true,
            headers,
            fieldDefs: AP_FIELDS,
            suggestedMapping: mapping,
            savedMappingUsed,
            preview,
            summary,
            rowCount: normalized.length,
            rawRowCount: rowCount,
            allRows: normalized,
        });
    } catch (err: unknown) {
        console.error("AP upload error:", err);
        return NextResponse.json({ error: (err as Error).message ?? "Upload failed" }, { status: 500 });
    }
}
