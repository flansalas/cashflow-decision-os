// GET /api/upload/mapping?companyId=xxx&kind=ar|ap
// Returns saved MappingProfile.mappingJson or {} if not found.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function GET(req: NextRequest) {
    const companyId = req.nextUrl.searchParams.get("companyId");
    const kind = req.nextUrl.searchParams.get("kind");

    if (!companyId || !kind) {
        return NextResponse.json({ error: "Missing companyId or kind" }, { status: 400 });
    }

    try {
        const profile = await prisma.mappingProfile.findFirst({
            where: { companyId, kind },
        });

        return NextResponse.json({
            found: !!profile,
            mappingJson: profile ? JSON.parse(profile.mappingJson) : {},
        });
    } catch (error) {
        console.error("Mapping GET error:", error);
        return NextResponse.json({ error: "Failed to load mapping" }, { status: 500 });
    }
}
