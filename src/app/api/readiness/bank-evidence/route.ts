import { NextRequest, NextResponse } from "next/server";
import prisma from "@/db/prisma";
import { resolveTenant } from "@/lib/tenant";

/** Returns only tenant-owned, successful bank-import evidence for owner review. */
export async function GET(req: NextRequest) {
    const companyId = await resolveTenant(req);
    if (!companyId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accounts = await prisma.bankAccount.findMany({
        where: { companyId, isActive: true },
        select: { id: true, name: true, role: true },
        orderBy: { name: "asc" }
    });

    const manifests = await prisma.bankImportManifest.findMany({
        where: { companyId },
        select: {
            id: true,
            userCertified: true,
            createdAt: true,
            BankImportManifestAccount: {
                where: { importSuccess: true, rejectedRowCount: 0 },
                select: {
                    bankAccountId: true,
                    coveredStartDate: true,
                    coveredEndDate: true,
                    userCertifiedAt: true
                }
            }
        },
        orderBy: { createdAt: "desc" }
    });

    return NextResponse.json({ accounts, manifests: manifests.filter(manifest => manifest.BankImportManifestAccount.length > 0) });
}
