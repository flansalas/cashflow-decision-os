import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

export async function PATCH(req: NextRequest) {
    try {
        const authResult = await auth();
        const userId = authResult?.userId;
        if (!userId) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { companyId, overrideId, changeLogId, reason } = body;

        if (!companyId || !overrideId || !changeLogId) {
            return NextResponse.json({ error: "Missing identifiers" }, { status: 400 });
        }

        // Verify tenant
        const company = await prisma.company.findUnique({ where: { id: companyId } });
        if (!company) {
            return NextResponse.json({ error: "Invalid company" }, { status: 403 });
        }

        // 1. Update Override
        const override = await prisma.override.findUnique({ where: { id: overrideId } });
        if (override && override.companyId === companyId) {
            let meta = {};
            try {
                if (override.metaJson) meta = JSON.parse(override.metaJson);
            } catch {}
            meta = { ...meta, reason };
            await prisma.override.update({
                where: { id: overrideId },
                data: { metaJson: JSON.stringify(meta) }
            });
        }

        // 2. Update ChangeLog
        const changeLog = await prisma.changeLog.findUnique({ where: { id: changeLogId } });
        if (changeLog && changeLog.companyId === companyId) {
            let diff = {};
            try {
                if (changeLog.diffJson) diff = JSON.parse(changeLog.diffJson);
            } catch {}
            diff = { ...diff, reason };

            const reasonSuffix = reason ? ` (Reason: ${reason})` : "";
            const baseText = (changeLog.inputText || "").replace(/\s*\(Reason:.*?\)$/, "");
            const newText = `${baseText}${reasonSuffix}`;

            await prisma.changeLog.update({
                where: { id: changeLogId },
                data: {
                    diffJson: JSON.stringify(diff),
                    inputText: newText
                }
            });
        }

        return NextResponse.json({ ok: true });
    } catch (e) {
        console.error("Reason patch error:", e);
        return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
}
