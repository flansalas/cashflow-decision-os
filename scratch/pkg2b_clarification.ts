import { prisma } from '../src/db/prisma';

async function runClarification() {
    try {
        await prisma.$transaction(async (tx) => {
            // Force read-only
            await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
            const companyId = '1a7b36f5-8fe0-4c2b-9336-8420846270b5';

            console.log("=== 1. 3 STAGED BATCHES ===");
            const stagedBatches = await tx.importBatch.findMany({
                where: { companyId, status: 'staged' },
                include: { application: true }
            });

            for (const batch of stagedBatches) {
                console.log(`\nBatch ID: ${batch.id}`);
                console.log(`Type: ${batch.importType} | File: ${batch.filename} | Status: ${batch.status}`);
                console.log(`UploadedAt: ${batch.uploadedAt} | Start: ${batch.sourceDateStart} | End: ${batch.sourceDateEnd}`);
                console.log(`Counts: Row=${batch.rowCount}, Accepted=${batch.acceptedCount}, Rejected=${batch.rejectedCount}, Dup=${batch.duplicateCount}`);
                console.log(`Hash: ${batch.fileHash}`);
                console.log(`Application exists: ${!!batch.application}`);
                if (batch.application) {
                    console.log(`AppliedAt: ${batch.application.appliedAt}`);
                }

                // Group rows manually
                const rows = await tx.stagedImportRow.findMany({
                    where: { importBatchId: batch.id },
                    select: { conflictType: true, validationStatus: true, userDecision: true, applyStatus: true }
                });

                const groupMap = new Map();
                for (const r of rows) {
                    const key = `${r.conflictType || 'none'}|${r.validationStatus || 'none'}|${r.userDecision ? 'non-NULL' : 'NULL'}|${r.applyStatus || 'none'}`;
                    groupMap.set(key, (groupMap.get(key) || 0) + 1);
                }

                console.log("Rows Summary:");
                for (const [k, v] of groupMap.entries()) {
                    console.log(`  [${k}] -> count: ${v}`);
                }
            }

            console.log("\n=== 2. BANK COVERAGE ===");
            const bankAccounts = await tx.bankAccount.findMany({
                where: { companyId, isActive: true },
            });
            for (const acc of bankAccounts) {
                console.log(`\nAccount: ${acc.id} (${acc.mask} ${acc.role})`);
                
                // Latest manifest for this account
                const link = await tx.bankImportManifestAccount.findFirst({
                    where: { bankAccountId: acc.id },
                    orderBy: { BankImportManifest: { createdAt: 'desc' } },
                    include: { BankImportManifest: true }
                });

                if (link && link.BankImportManifest) {
                    console.log(`Manifest ID: ${link.BankImportManifest.id}`);
                    console.log(`Start: ${link.BankImportManifest.coveredStartDate} | End: ${link.BankImportManifest.coveredEndDate}`);
                    console.log(`Success: ${link.BankImportManifest.importSuccess} | Rejected: ${link.BankImportManifest.rejectedRowCount}`);
                    console.log(`Certified: ${link.BankImportManifest.userCertified} | CertifiedAt: ${link.BankImportManifest.userCertifiedAt}`);
                } else {
                    console.log(`No manifest link found.`);
                }

                const latestTx = await tx.bankTransaction.findFirst({
                    where: { accountId: acc.id },
                    orderBy: { txDate: 'desc' }
                });
                console.log(`Latest BankTx Date: ${latestTx ? latestTx.txDate : 'NONE'}`);
            }

            console.log("\n=== 3. AR/AP EVIDENCE ===");
            const company = await tx.company.findUnique({
                where: { id: companyId },
                include: { notes: true }
            });
            const arNote = company?.notes.find(n => n.noteText && n.noteText.includes('ar_refresh_at'));
            const apNote = company?.notes.find(n => n.noteText && n.noteText.includes('ap_refresh_at'));
            
            console.log(`AR Note: ${arNote?.noteText}`);
            console.log(`AP Note: ${apNote?.noteText}`);

            // AR
            const arRows = await tx.receivableInvoice.aggregate({
                where: { companyId, status: 'open' },
                _count: { id: true },
                _sum: { amountOpen: true },
                _min: { createdAt: true, updatedAt: true },
                _max: { createdAt: true, updatedAt: true },
            });
            console.log(`AR Source: count=${arRows._count.id}, sum=${arRows._sum.amountOpen}`);
            console.log(`AR range: Created: [${arRows._min.createdAt}, ${arRows._max.createdAt}] Updated: [${arRows._min.updatedAt}, ${arRows._max.updatedAt}]`);

            const appliedARApps = await tx.importApplication.count({
                where: { batch: { companyId, importType: 'ar' }, status: 'applied' }
            });
            console.log(`Any applied AR historical applications: ${appliedARApps > 0}`);

            // AP
            const apRows = await tx.payableBill.aggregate({
                where: { companyId, status: 'open' },
                _count: { id: true },
                _sum: { amountOpen: true },
                _min: { createdAt: true, updatedAt: true },
                _max: { createdAt: true, updatedAt: true },
            });
            console.log(`AP Source: count=${apRows._count.id}, sum=${apRows._sum.amountOpen}`);
            console.log(`AP range: Created: [${apRows._min.createdAt}, ${apRows._max.createdAt}] Updated: [${apRows._min.updatedAt}, ${apRows._max.updatedAt}]`);

            const appliedAPApps = await tx.importApplication.count({
                where: { batch: { companyId, importType: 'ap' }, status: 'applied' }
            });
            console.log(`Any applied AP historical applications: ${appliedAPApps > 0}`);

            console.log("\n=== 4. RECONCILIATION OVERLAP ===");
            const overlaps = await tx.stagedImportRow.findMany({
                where: { companyId },
                select: { conflictType: true, importType: true }
            });
            console.log(`Total StagedImportRows with conflictType non-null: ${overlaps.length}`);
            
            // Unresolved Economic Overlap check: Are there multiple source events claiming same bank tx?
            // This happens via ReconciliationLink usually, but if none exist...
            // Let's just output the conflicts found.
            const overlapCounts = {};
            for (const o of overlaps) {
                overlapCounts[o.conflictType] = (overlapCounts[o.conflictType] || 0) + 1;
            }
            console.log(`Overlap Types: ${JSON.stringify(overlapCounts)}`);

            console.log("\n=== 5. FORECAST CHECKPOINTS ===");
            const unsealed = await tx.forecastCheckpoint.findMany({
                where: { companyId, sealedAt: null }
            });
            for (const cp of unsealed) {
                console.log(`Checkpoint ${cp.id} | versionHash=${cp.forecastVersionHash} | created=${cp.createdAt}`);
            }

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

runClarification();
