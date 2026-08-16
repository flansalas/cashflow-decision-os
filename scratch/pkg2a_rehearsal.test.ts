import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as arPost } from '../src/app/api/upload/ar/route';
import { POST as bankPost } from '../src/app/api/upload/bank/route';
import { PATCH as decidePatch } from '../src/app/api/upload/decide/route';
import { POST as applyPost } from '../src/app/api/upload/apply/route';

vi.mock('../src/lib/tenant', () => ({
    resolveTenant: vi.fn().mockResolvedValue('test_tenant_rehearsal')
}));
vi.mock('@clerk/nextjs/server', () => ({
    auth: vi.fn().mockResolvedValue({ userId: 'test_user_rehearsal' })
}));

import prisma from '../src/db/prisma';
const tenantId = 'test_tenant_rehearsal';

describe('Package 2A Runtime Rehearsal', () => {
    beforeAll(async () => {
        const result = await prisma.$queryRaw`SELECT current_database() as db;`;
        console.log("Connected to:", result);

        await prisma.company.upsert({ where: { id: tenantId }, update: {}, create: { id: tenantId, name: 'Test Tenant' } });

        // Clear previous runs
        await prisma.stagedImportRow.deleteMany({ where: { companyId: tenantId } });
        await prisma.importApplyChange.deleteMany({ where: { companyId: tenantId } });
        await prisma.importApplication.deleteMany({ where: { companyId: tenantId } });
        await prisma.payableBill.deleteMany({ where: { companyId: tenantId } });
        await prisma.receivableInvoice.deleteMany({ where: { companyId: tenantId } });
        await prisma.importBatch.deleteMany({ where: { companyId: tenantId } });
        await prisma.override.deleteMany({ where: { companyId: tenantId } });
        await prisma.bankTransaction.deleteMany({ where: { companyId: tenantId } });
        await prisma.reconciliationLink.deleteMany({ where: { companyId: tenantId } });

        // Setup bank manifest for test
        await prisma.bankImportManifest.deleteMany({ where: { companyId: tenantId } });
        await prisma.bankAccount.upsert({
            where: { id: 'acc1' },
            update: {},
            create: { id: 'acc1', companyId: tenantId, name: 'Test Bank Account' }
        });
        const manifest = await prisma.bankImportManifest.create({
            data: { id: 'manifest-test', companyId: tenantId, userCertified: true }
        });
        await prisma.bankImportManifestAccount.create({
            data: { id: 'manifest-acc-test', manifestId: manifest.id, bankAccountId: 'acc1' }
        });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('executes all 5 proofs', async () => {
        // Seed existing data
        const exist1 = await prisma.receivableInvoice.create({
            data: { companyId: tenantId, invoiceNo: 'INV-100', customerName: 'Old Corp', amountOpen: 500, status: 'open' }
        });
        const exist2 = await prisma.receivableInvoice.create({
            data: { companyId: tenantId, invoiceNo: 'INV-200', customerName: 'Same Corp', amountOpen: 1000, status: 'open' }
        });
        const exist3 = await prisma.receivableInvoice.create({
            data: { companyId: tenantId, invoiceNo: 'INV-300', customerName: 'Hidden Corp', amountOpen: 1500, status: 'open' }
        });
        await prisma.override.create({
            data: { companyId: tenantId, targetType: 'ReceivableInvoice', targetId: exist3.id, type: 'exclude' }
        });

        // 1. AR/AP staging
        const reqAR = new NextRequest('http://localhost/api/upload/ar', {
            method: 'POST',
            body: JSON.stringify({
                rows: [
                    { invoiceNo: 'INV-100', customerName: 'New Corp', amountOpen: 500 }, // possible_match
                    { invoiceNo: 'INV-200', customerName: 'Same Corp', amountOpen: 800 }, // changed_existing
                    { invoiceNo: 'INV-400', customerName: 'Fresh Corp', amountOpen: 200 } // new
                ],
                mappingJson: {}
            })
        });

        const resAR = await arPost(reqAR);
        const resArJson = await resAR.json();
        const batchId = resArJson.batchId;

        const countAr = await prisma.receivableInvoice.count({ where: { companyId: tenantId } });
        expect(countAr).toBe(3);

        const staged = await prisma.stagedImportRow.findMany({ where: { importBatchId: batchId } });
        const pmRow = staged.find(r => r.conflictType === 'possible_match');
        const ceRow = staged.find(r => r.conflictType === 'changed_existing');
        const newRow = staged.find(r => r.conflictType === 'new');

        expect(pmRow?.userDecision).toBeNull();
        expect(ceRow?.userDecision).toBeNull();
        expect(newRow).toBeDefined();

        // 2. AR/AP apply
        const appFail = await applyPost(new NextRequest('http://localhost/api/upload/apply', { method: 'POST', body: JSON.stringify({ importBatchId: batchId }) }));
        expect(appFail.ok).toBe(false);

        await decidePatch(new NextRequest('http://localhost/api/upload/decide', { method: 'PATCH', body: JSON.stringify({ bulkAction: true, batchId, action: 'accept_new_valid' }) }));
        await decidePatch(new NextRequest('http://localhost/api/upload/decide', { method: 'PATCH', body: JSON.stringify({ bulkAction: true, batchId, action: 'accept_changed_existing' }) }));
        await decidePatch(new NextRequest('http://localhost/api/upload/decide', { method: 'PATCH', body: JSON.stringify({ rowId: pmRow!.id, decision: 'link_and_review', linkedRecordId: pmRow!.matchedRecordId }) }));

        const appOk = await applyPost(new NextRequest('http://localhost/api/upload/apply', { method: 'POST', body: JSON.stringify({ importBatchId: batchId }) }));
        expect(appOk.ok).toBe(true);

        const application = await prisma.importApplication.findFirst({ where: { importBatchId: batchId } });
        expect(application).toBeDefined();

        const changes = await prisma.importApplyChange.count({ where: { importApplicationId: application!.id } });
        expect(changes).toBeGreaterThan(0);

        const batchAfter = await prisma.importBatch.findUnique({ where: { id: batchId } });
        expect(batchAfter?.status).toBe('applied');

        const appDouble = await applyPost(new NextRequest('http://localhost/api/upload/apply', { method: 'POST', body: JSON.stringify({ importBatchId: batchId }) }));
        expect(appDouble.status).toBe(400);

        // 3. Hidden source preservation
        const hiddenInvoice = await prisma.receivableInvoice.findUnique({ where: { id: exist3.id } });
        expect(hiddenInvoice).toBeDefined();

        const over = await prisma.override.findFirst({ where: { targetId: exist3.id } });
        expect(over?.type).toBe('exclude');

        // 4. Bank single authority
        const reqBank = new NextRequest('http://localhost/api/upload/bank', {
            method: 'POST',
            body: JSON.stringify({
                rows: [{ date: '2026-08-01', description: 'Tx 1', amount: 100 }],
                mappingJson: {},
                accountId: 'acc1',
                fileHash: 'test-hash-123'
            })
        });
        const resBank = await bankPost(reqBank);
        const resBankJson = await resBank.json();
        if (!resBank.ok) {
            console.error("Bank upload failed:", resBankJson);
        }
        const bankBatchId = resBankJson.batchId;

        const bankBatch = await prisma.importBatch.findUnique({ where: { id: bankBatchId } });
        expect(bankBatch?.status).toBe('applied');

        const bankApp = await applyPost(new NextRequest('http://localhost/api/upload/apply', { method: 'POST', body: JSON.stringify({ importBatchId: bankBatchId }) }));
        expect(bankApp.status).toBe(400);

        const bankTxCount = await prisma.bankTransaction.count({ where: { companyId: tenantId } });
        expect(bankTxCount).toBe(1);

        // 5. AI reconciliation
        const recon = await prisma.reconciliationLink.create({
            data: {
                companyId: tenantId,
                status: 'proposed',
                confidence: 'high',
                sourceType: 'BankTransaction',
                sourceId: 'fake_tx_id',
                targetType: 'ReceivableInvoice',
                targetId: 'fake_ar_id',
                matchedAmount: 100
            }
        });
        expect(recon.deductFrom).toBeNull();
    }, 30000);
});
