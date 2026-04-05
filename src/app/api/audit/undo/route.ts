import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { changeLogId } = body;

        if (!changeLogId) {
            return NextResponse.json({ error: "Missing changeLogId" }, { status: 400 });
        }

        const log = await prisma.changeLog.findUnique({ where: { id: changeLogId } });
        if (!log) return NextResponse.json({ error: "Log not found" }, { status: 404 });

        let diffData: any;
        try { 
            diffData = JSON.parse(log.diffJson); 
        } catch { 
            return NextResponse.json({ error: "Cannot undo: Invalid diffJson format." }, { status: 400 }); 
        }

        // We only support undoing specific granular actions for now to avoid cascading data errors
        if (log.action === "FORECAST_OVERRIDE") {
            const { targetId, type } = diffData;
            if (targetId && type) {
                await prisma.override.updateMany({
                    where: { targetId, type, status: "active" },
                    data: { status: "archived" }
                });
                
                await prisma.changeLog.create({
                    data: {
                        companyId: log.companyId,
                        action: "UNDO_ACTION",
                        source: "user_ui",
                        inputText: `Undid override action: ${type.replace(/_/g, ' ')}`,
                        diffJson: JSON.stringify({ revertedChangeLogId: log.id }),
                        forecastVersionHashAfter: "pending"
                    }
                });
                return NextResponse.json({ ok: true });
            }
        } 
        else if (log.action === "REMOVE_OVERRIDE") {
            const { targetId, type } = diffData;
            if (targetId && type) {
                // Find latest archived one and make it active
                const archived = await prisma.override.findFirst({
                    where: { targetId, type, status: "archived" },
                    orderBy: { effectiveDate: 'desc' }
                });
                
                if (archived) {
                    await prisma.override.update({
                        where: { id: archived.id },
                        data: { status: "active" }
                    });
                    
                    await prisma.changeLog.create({
                        data: {
                            companyId: log.companyId,
                            action: "UNDO_ACTION",
                            source: "user_ui",
                            inputText: `Restored removed override: ${type.replace(/_/g, ' ')}`,
                            diffJson: JSON.stringify({ revertedChangeLogId: log.id }),
                            forecastVersionHashAfter: "pending"
                        }
                    });
                    return NextResponse.json({ ok: true });
                }
            }
        }

        return NextResponse.json({ error: "This type of action cannot be undone automatically." }, { status: 400 });
    } catch (e: any) {
        console.error("Undo error:", e);
        return NextResponse.json({ error: "Internal server error during undo." }, { status: 500 });
    }
}
