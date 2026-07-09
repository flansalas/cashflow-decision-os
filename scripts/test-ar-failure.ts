import { NextRequest } from "next/server";
import { POST as ingestARPost } from "../src/app/api/ingest/ar/confirm/route";
import prisma from "../src/db/prisma";

async function run() {
    let comp = await prisma.company.findFirst();
    if (!comp) comp = await prisma.company.create({ data: { name: "Test Co" } });
    const companyId = comp.id;

    // To force an error in the try block, we can pass a really long string that exceeds db column length,
    // or pass `null` to a non-nullable Prisma field that we bypass in TypeScript via `as any`.
    const badRow: any = {
        customerName: null, // this will fail prisma create because customerName is required String
        invoiceNo: 'INV-BAD',
        amountOpen: 500,
        status: "open"
    };

    const reqAR = new NextRequest("http://localhost/api/ingest/ar/confirm", {
        method: "POST",
        body: JSON.stringify({
            companyId,
            filename: "bad_import.csv",
            rows: [badRow]
        })
    });

    const res = await ingestARPost(reqAR);
    console.log("Response status:", res.status);

    const batches = await prisma.importBatch.findMany({
        where: { companyId, filename: "bad_import.csv" },
        orderBy: { uploadedAt: 'desc' }
    });
    console.log("Failed batches created:", batches.length);
    if (batches.length > 0) {
        console.log("Batch status:", batches[0].status);
        console.log("Batch errorSummary:", batches[0].errorSummary);
    }
}

run().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
