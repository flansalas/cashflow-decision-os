import { prisma } from '../src/db/prisma';

async function runInventory() {
    const companyId = '1a7b36f5-8fe0-4c2b-9336-8420846270b5';

    try {
        await prisma.$transaction(async (tx) => {
            // Set transaction to READ ONLY if possible, but Prisma doesn't have a direct wrapper for this.
            // We will throw an error at the end to guarantee rollback.
            await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);

            console.log("=== 1. COMPANY / STARTING CASH ===");
            const company = await tx.company.findUnique({ where: { id: companyId } });
            console.log("Company:", company ? { id: company.id, name: company.name } : "NOT FOUND");

            const latestCash = await tx.cashSnapshot.findFirst({
                where: { companyId },
                orderBy: { asOfDate: 'desc' }
            });
            console.log("Latest CashSnapshot:", latestCash ? {
                id: latestCash.id, asOfDate: latestCash.asOfDate, balance: latestCash.bankBalance, createdAt: latestCash.createdAt
            } : "NONE");

            const notes = await tx.companyNote.findMany({
                where: { companyId }
            });
            console.log("Company Notes:", notes.map(n => ({ id: n.id, content: n.noteText, createdAt: n.createdAt })));

            console.log("\n=== 2. BANK SOURCE COVERAGE ===");
            const accounts = await tx.bankAccount.findMany({
                where: { companyId, isActive: true },
                include: {
                    transactions: {
                        orderBy: { txDate: 'asc' },
                        select: { txDate: true }
                    }
                }
            });
            for (const acc of accounts) {
                const txs = acc.transactions;
                console.log(`BankAccount: ${acc.id} | ${acc.name} | role: ${acc.role} | active: ${acc.isActive}`);
                console.log(`  Tx Count: ${txs.length}`);
                if (txs.length > 0) {
                    console.log(`  Earliest: ${txs[0].txDate}, Latest: ${txs[txs.length - 1].txDate}`);
                }
            }

            const latestManifest = await tx.bankImportManifest.findFirst({
                where: { companyId },
                orderBy: { createdAt: 'desc' },
                include: { BankImportManifestAccount: true }
            });
            console.log("Latest Bank Manifest:", latestManifest ? {
                id: latestManifest.id,
                importSuccess: latestManifest.importSuccess,
                rejectedRowCount: latestManifest.rejectedRowCount,
                userCertified: latestManifest.userCertified,
                userCertifiedAt: latestManifest.userCertifiedAt,
                accounts: latestManifest.BankImportManifestAccount.map(a => ({
                    accountId: a.bankAccountId,
                    start: a.coveredStartDate,
                    end: a.coveredEndDate
                }))
            } : "NONE");

            console.log("\n=== 3. AR ===");
            const allAR = await tx.receivableInvoice.findMany({ where: { companyId } });
            console.log(`Raw AR Total Count: ${allAR.length}`);
            const arByStatus = {};
            for (const ar of allAR) {
                arByStatus[ar.status] = (arByStatus[ar.status] || {count: 0, amount: 0});
                arByStatus[ar.status].count++;
                arByStatus[ar.status].amount += Number(ar.amountOpen);
            }
            console.log(`AR by Status:`, arByStatus);

            const latestARBatch = await tx.importBatch.findFirst({
                where: { companyId, importType: 'ar' },
                orderBy: { uploadedAt: 'desc' }
            });
            console.log("Latest AR Batch:", latestARBatch ? {
                id: latestARBatch.id, status: latestARBatch.status, uploadedAt: latestARBatch.uploadedAt
            } : "NONE");

            if (latestARBatch) {
                const arRows = await tx.stagedImportRow.findMany({ where: { importBatchId: latestARBatch.id } });
                console.log("AR Staged Rows:");
                const groups = {};
                for (const row of arRows) {
                    const key = `${row.conflictType}_${row.userDecision}_${row.applyStatus}`;
                    groups[key] = (groups[key] || 0) + 1;
                }
                console.log(groups);
            }

            console.log("\n=== 4. AP ===");
            const allAP = await tx.payableBill.findMany({ where: { companyId } });
            console.log(`Raw AP Total Count: ${allAP.length}`);
            const apByStatus = {};
            for (const ap of allAP) {
                apByStatus[ap.status] = (apByStatus[ap.status] || {count: 0, amount: 0});
                apByStatus[ap.status].count++;
                apByStatus[ap.status].amount += Number(ap.amountOpen);
            }
            console.log(`AP by Status:`, apByStatus);

            const latestAPBatch = await tx.importBatch.findFirst({
                where: { companyId, importType: 'ap' },
                orderBy: { uploadedAt: 'desc' }
            });
            console.log("Latest AP Batch:", latestAPBatch ? {
                id: latestAPBatch.id, status: latestAPBatch.status, uploadedAt: latestAPBatch.uploadedAt
            } : "NONE");

            if (latestAPBatch) {
                const apRows = await tx.stagedImportRow.findMany({ where: { importBatchId: latestAPBatch.id } });
                console.log("AP Staged Rows:");
                const groups = {};
                for (const row of apRows) {
                    const key = `${row.conflictType}_${row.userDecision}_${row.applyStatus}`;
                    groups[key] = (groups[key] || 0) + 1;
                }
                console.log(groups);
            }

            console.log("\n=== 5. ASSUMPTIONS / RECURRING ===");
            const activePatterns = await tx.recurringPattern.findMany({ where: { companyId, status: 'active' } });
            console.log(`Active Patterns Count: ${activePatterns.length}`);
            const cadences = {};
            for (const p of activePatterns) {
                const key = `${p.cadence}_${p.category}`;
                cadences[key] = (cadences[key] || 0) + Number(p.typicalAmount);
            }
            console.log("Aggregates by cadence/category:", cadences);

            console.log("\n=== 6. RECONCILIATIONS ===");
            const recons = await tx.reconciliationLink.findMany({ where: { companyId } });
            console.log(`Total Active Links: ${recons.length}`);
            console.log(`deductFrom NULL Count: ${recons.filter(r => !r.deductFrom).length}`);
            console.log(`deductFrom non-NULL Count: ${recons.filter(r => !!r.deductFrom).length}`);
            console.log(`Status Pending: ${recons.filter(r => r.status === 'pending' || r.status === 'proposed').length}`);

            console.log("\n=== 7. BASELINE ===");
            const latestBaseline = await tx.baselineSnapshot.findFirst({
                where: { companyId },
                orderBy: { asOfDate: 'desc' }
            });
            console.log("Latest Baseline:", latestBaseline ? {
                createdAt: latestBaseline.createdAt,
                asOf: latestBaseline.asOfDate,
                weeklyInflow: latestBaseline.variableInflowWeekly,
                weeklyOutflow: latestBaseline.variableOutflowWeekly,
                confidence: latestBaseline.baselineConfidenceTier
            } : "NONE");

            console.log("\n=== 8. FORECAST / DECISION SPINE ===");
            const latestCheckpoints = await tx.forecastCheckpoint.findMany({
                where: { companyId },
                orderBy: { createdAt: 'desc' },
                take: 2,
                include: {
                    forecastWeeks: true,
                    executionPlans: true
                }
            });
            latestCheckpoints.forEach((cp, i) => {
                console.log(`Checkpoint ${i+1}: id=${cp.id}, sealed=${!!cp.sealedAt}, versionHash=${cp.forecastVersionHash}, weeks=${cp.forecastWeeks.length}, plans=${cp.executionPlans.length}`);
            });

            console.log("\n=== 9. IMPORT HEALTH SUMMARY ===");
            const totalBatches = await tx.importBatch.count({ where: { companyId } });
            const appliedBatches = await tx.importBatch.count({ where: { companyId, status: 'applied' } });
            const stagedBatches = await tx.importBatch.count({ where: { companyId, status: 'staged' } });
            const errorBatches = await tx.importBatch.count({ where: { companyId, status: 'error' } });
            console.log(`ImportBatches: Total=${totalBatches}, Applied=${appliedBatches}, Staged=${stagedBatches}, Error=${errorBatches}`);
            
            const totalApps = await tx.importApplication.count({ where: { companyId } });
            console.log(`ImportApplications: Total=${totalApps}`);

            const totalRows = await tx.stagedImportRow.count({ where: { companyId } });
            const appliedRows = await tx.stagedImportRow.count({ where: { companyId, applyStatus: 'applied' } });
            console.log(`StagedImportRows: Total=${totalRows}, Applied=${appliedRows}, Unresolved=${totalRows - appliedRows}`);

            throw new Error("ROLLBACK_FOR_READ_ONLY");
        }, { timeout: 30000 });
    } catch (e) {
        if (e.message === "ROLLBACK_FOR_READ_ONLY") {
            console.log("\n✅ Read-only transaction rolled back successfully.");
        } else {
            console.error("Error:", e);
        }
    } finally {
        await prisma.$disconnect();
    }
}

runInventory().catch(console.error);
