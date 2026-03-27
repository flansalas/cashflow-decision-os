// POST /api/ingest/ar/upload
// Accepts multipart form-data (file + companyId).
// Parses server-side, returns: suggestedMapping, preview (10 rows), summary, allRows.
// Client then adjusts mapping and POSTs to /api/ingest/ar/confirm.

import { NextRequest, NextResponse } from "next/server";
import { parseBuffer } from "@/services/ingest/parseRows";
import { prepareAR, normalizeARRows, arPreview, AR_FIELDS } from "@/services/ingest/ar";
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

        // Load saved mapping if any
        const saved = await prisma.mappingProfile.findFirst({ where: { companyId, kind: "ar" } });
        const savedMapping = saved ? (JSON.parse(saved.mappingJson) as Record<string, string>) : null;

        const { mapping, savedMappingUsed } = prepareAR(headers, savedMapping);
        const normalized = normalizeARRows(rows, mapping);
        const { preview, summary } = arPreview(normalized);

        return NextResponse.json({
            ok: true,
            headers,
            fieldDefs: AR_FIELDS,
            suggestedMapping: mapping,
            savedMappingUsed,
            preview,
            summary,
            rowCount: normalized.length,
            rawRowCount: rowCount,
            // All normalized rows — client sends these back on confirm
            allRows: normalized,
        });
    } catch (err: unknown) {
        console.error("AR upload error:", err);
        return NextResponse.json({ error: (err as Error).message ?? "Upload failed" }, { status: 500 });
    }
}
