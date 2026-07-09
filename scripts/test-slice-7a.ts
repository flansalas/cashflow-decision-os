import { NextRequest } from "next/server";
import { POST as ingestARPost } from "../src/app/api/ingest/ar/confirm/route";
import { POST as uploadBankPost } from "../src/app/api/upload/bank/route";
import prisma from "../src/db/prisma";

// Mock resolveTenant by monkeypatching later

async function run() {
    let comp = await prisma.company.findFirst({ where: { id: "test-tenant-id" }});
    if (!comp) comp = await prisma.company.create({ data: { id: "test-tenant-id", name: "Test Co" } });
    const companyId = comp.id;

    console.log("=== Running Slice 7A Gaps Tests ===");

    // Clean up
    await prisma.stagedImportRow.deleteMany();
    await prisma.importBatch.deleteMany();
    await prisma.bankTransaction.deleteMany({ where: { companyId } });

    // Seed existing BankTransaction to test exact duplicate
    await prisma.bankTransaction.create({
        data: {
            companyId,
            txDate: new Date("2023-01-01"),
            description: "Test tx duplicate",
            amount: 100,
            direction: "inflow"
        }
    });

    console.log("\\nTesting Bank deduplication and raw data...");

    // Simulate what the client sends. Note the _raw field.
    const bankRows = [
        {
            date: "2023-01-01",
            description: "Test tx duplicate",
            amount: 100,
            _raw: { rawDate: "01/01/2023", rawDesc: "Test tx duplicate", rawAmt: "100.00" }
        }, // Matches DB
        {
            date: "2023-01-02",
            description: "New tx",
            amount: 50,
            _raw: { rawDate: "01/02/2023", rawDesc: "New tx", rawAmt: "50.00" }
        }, // New
        {
            date: "2023-01-02",
            description: "New tx",
            amount: 50,
            _raw: { rawDate: "01/02/2023", rawDesc: "New tx dup", rawAmt: "50.00" }
        }, // Duplicate within batch!
    ];

    const reqBank = new NextRequest("http://localhost/api/upload/bank?companyId=" + companyId, {
        method: "POST",
        body: JSON.stringify({ companyId: "ignored", filename: "bank.csv", rows: bankRows, mappingJson: {} })
    });

    const resBank = await uploadBankPost(reqBank);
    const dataBank = await resBank.json();
    console.log("Bank Response:", dataBank);

    if (dataBank.status === "staged_with_errors") console.log("✅ Bank batch status is staged_with_errors");

    // Check duplicate logic and raw data
    const stagedRows = await prisma.stagedImportRow.findMany({ where: { importBatchId: dataBank.batchId }, orderBy: { sourceRowNumber: 'asc' }});

    const dbDup = stagedRows[0];
    if (dbDup.conflictType === "exact_duplicate" && dbDup.proposedAction === "skip") {
        console.log("✅ Bank duplicate against an existing transaction is flagged");
    }

    const batchDup = stagedRows[2];
    if (batchDup.conflictType === "exact_duplicate" && batchDup.proposedAction === "skip") {
        console.log("✅ Duplicate within the same uploaded batch is flagged");
    }

    const rawData = JSON.parse(dbDup.rawDataJson);
    const normData = JSON.parse(dbDup.normalizedDataJson);
    if (rawData.rawDate === "01/01/2023" && normData.date === "2023-01-01") {
        console.log("✅ rawDataJson differs from normalizedDataJson when normalization changes a value");
    }

    // Cross-tenant failure
    const reqFail = new NextRequest("http://localhost/api/upload/bank", {
        method: "POST",
        body: JSON.stringify({ companyId: "client-provided-but-ignored", rows: [], mappingJson: {} })
    });
    const resFail = await uploadBankPost(reqFail);
    if (resFail.status === 401) {
        console.log("✅ Cross-tenant staging attempt is rejected");
    }
}

run().catch(e => { console.error(e); process.exit(1); }).finally(() => process.exit(0));
