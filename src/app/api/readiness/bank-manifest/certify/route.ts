import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

/** Certifies one tenant-owned, successful bank import manifest for readiness coverage. */
export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const companyId = await resolveTenant(req);
    if (!companyId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { manifestId } = await req.json();
    if (!manifestId || typeof manifestId !== "string") {
        return NextResponse.json({ error: "manifestId is required" }, { status: 400 });
    }

    const manifest = await prisma.bankImportManifest.findUnique({
        where: { id: manifestId },
        include: {
            BankImportManifestAccount: {
                select: { id: true, importSuccess: true, rejectedRowCount: true }
            }
        }
    });

    if (!manifest) {
        return NextResponse.json({ error: "Manifest not found" }, { status: 404 });
    }
    if (manifest.companyId !== companyId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (
        manifest.BankImportManifestAccount.length === 0 ||
        manifest.BankImportManifestAccount.some(account => !account.importSuccess || account.rejectedRowCount !== 0)
    ) {
        return NextResponse.json({ error: "Only successful manifests with no rejected rows can be certified" }, { status: 400 });
    }

    const certifiedAt = new Date();
    await prisma.$transaction(async tx => {
        await tx.bankImportManifest.update({
            where: { id: manifest.id },
            data: { userCertified: true }
        });
        await tx.bankImportManifestAccount.updateMany({
            where: { manifestId: manifest.id },
            data: { userCertifiedAt: certifiedAt }
        });
        await tx.changeLog.create({
            data: {
                companyId,
                userId,
                source: "BankImportManifest",
                action: "certify",
                inputText: manifest.id,
                diffJson: JSON.stringify({ manifestId: manifest.id, certifiedAt: certifiedAt.toISOString(), certifiedBy: userId }),
                forecastVersionHashAfter: "pending"
            }
        });
    });

    return NextResponse.json({ manifestId: manifest.id, userCertified: true, certifiedAt });
}
