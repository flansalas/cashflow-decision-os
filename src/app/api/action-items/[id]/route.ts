import { NextResponse } from "next/server";
import { getAuth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    try {
        const { orgId, userId } = getAuth(req as any);
        if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const company = await prisma.company.findUnique({
            where: { clerkOrgId: orgId },
        });

        if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

        const { id } = params;
        const body = await req.json();
        const { status, completionNote, actualAmountImpact } = body;

        const actionItem = await prisma.actionItem.findFirst({
            where: { id, companyId: company.id }
        });

        if (!actionItem) {
            return NextResponse.json({ error: "ActionItem not found" }, { status: 404 });
        }

        const validStatuses = ["planned", "completed", "missed", "cancelled"];
        if (status && !validStatuses.includes(status)) {
            return NextResponse.json({ error: "Invalid status" }, { status: 400 });
        }

        let updateData: any = {};
        if (status) updateData.status = status;
        if (completionNote !== undefined) updateData.completionNote = completionNote;

        const newStatus = status || actionItem.status;

        if (newStatus === "completed" && actionItem.status !== "completed") {
            updateData.completedAt = new Date();
        } else if (newStatus !== "completed") {
            updateData.completedAt = null;
        }

        const finalNote = completionNote !== undefined ? completionNote : actionItem.completionNote;

        if (actualAmountImpact !== undefined && actualAmountImpact !== null) {
            if (newStatus !== "completed") {
                return NextResponse.json({ error: "actualAmountImpact can only be set when status is completed" }, { status: 400 });
            }
            if (typeof actualAmountImpact !== "number" || !Number.isFinite(actualAmountImpact)) {
                return NextResponse.json({ error: "actualAmountImpact must be a finite number or null" }, { status: 400 });
            }
            if (!finalNote || finalNote.trim() === "") {
                return NextResponse.json({ error: "manual actualAmountImpact requires a non-empty completionNote" }, { status: 400 });
            }
            updateData.actualAmountImpact = actualAmountImpact;
        } else if (actualAmountImpact === null || newStatus === "missed" || newStatus === "cancelled" || newStatus === "planned") {
            updateData.actualAmountImpact = null;
        }

        const result = await prisma.$transaction(async (tx) => {
            const updated = await tx.actionItem.update({
                where: { id },
                data: updateData
            });

            await tx.changeLog.create({
                data: {
                    companyId: company.id,
                    source: "user_ui",
                    action: "UPDATE_ACTION_ITEM",
                    inputText: completionNote || null,
                    diffJson: JSON.stringify({ actionId: id, updateData }),
                    forecastVersionHashAfter: "unchanged",
                    userId: userId
                }
            });

            return updated;
        });

        return NextResponse.json({ success: true, actionItem: result });

    } catch (e: any) {
        console.error("ActionItem PATCH Error:", e);
        return NextResponse.json({ error: e.message || "Internal Server Error" }, { status: 500 });
    }
}
