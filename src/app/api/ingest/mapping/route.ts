// GET /api/ingest/mapping?companyId=xxx&type=AR|AP
// Returns saved MappingProfile for a company + file type, or {} if not found.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

export async function GET(req: NextRequest) {
    const companyId = await resolveTenant(req);
    const type = req.nextUrl.searchParams.get("type")?.toLowerCase();

    if (!companyId || !type) {
        return NextResponse.json({ error: "Missing tenant or type" }, { status: 400 });
    }
    if (type !== "ar" && type !== "ap") {
        return NextResponse.json({ error: 'type must be "ar" or "ap"' }, { status: 400 });
    }

    try {
        const profile = await prisma.mappingProfile.findFirst({ where: { companyId, kind: type } });
        return NextResponse.json({
            found: !!profile,
            mappingJson: profile ? (JSON.parse(profile.mappingJson) as Record<string, string>) : {},
            updatedAt: profile?.updatedAt ?? null,
        });
    } catch (err: unknown) {
        console.error("Mapping GET error:", err);
        return NextResponse.json({ error: "Failed to load mapping" }, { status: 500 });
    }
}
