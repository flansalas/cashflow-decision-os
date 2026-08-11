import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../route';
import { NextRequest } from 'next/server';
import prisma from '@/db/prisma';
import { resolveTenant } from '@/lib/tenant';
import { getAuth } from '@clerk/nextjs/server';

vi.mock('@/db/prisma', () => ({
    default: {
        bankAccount: {
            findFirst: vi.fn(),
            update: vi.fn(),
        },
        baselineSnapshot: {
            deleteMany: vi.fn(),
        }
    }
}));

vi.mock('@clerk/nextjs/server', () => ({
    getAuth: vi.fn()
}));

vi.mock('@/lib/tenant', () => ({
    resolveTenant: vi.fn()
}));

vi.mock('@vercel/functions', () => ({
    waitUntil: vi.fn()
}));

vi.mock('@/services/baseline-snapshot', () => ({
    buildAndCacheBaseline: vi.fn()
}));

describe('BankAccount Role POST Route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rejects update if cross-tenant (account belongs to different company)', async () => {
        vi.mocked(getAuth).mockReturnValue({ userId: 'user1' } as any);
        vi.mocked(resolveTenant).mockResolvedValue('company-a');
        
        // Mock findFirst returning null (meaning account not found for company-a)
        vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue(null);

        const req = new NextRequest('http://localhost/api', {
            method: 'POST',
            body: JSON.stringify({ role: 'payroll' })
        });
        
        const response = await POST(req, { params: Promise.resolve({ accountId: 'acc-123' }) });
        
        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe('Account not found or access denied');
        
        expect(prisma.bankAccount.findFirst).toHaveBeenCalledWith({
            where: { id: 'acc-123', companyId: 'company-a' }
        });
        
        expect(prisma.bankAccount.update).not.toHaveBeenCalled();
    });

    it('allows update if account belongs to resolved tenant', async () => {
        vi.mocked(getAuth).mockReturnValue({ userId: 'user1' } as any);
        vi.mocked(resolveTenant).mockResolvedValue('company-a');
        
        // Mock findFirst returning the account (meaning it belongs to company-a)
        vi.mocked(prisma.bankAccount.findFirst).mockResolvedValue({ id: 'acc-123', companyId: 'company-a' } as any);
        vi.mocked(prisma.bankAccount.update).mockResolvedValue({ id: 'acc-123', role: 'payroll' } as any);

        const req = new NextRequest('http://localhost/api', {
            method: 'POST',
            body: JSON.stringify({ role: 'payroll' })
        });
        
        const response = await POST(req, { params: Promise.resolve({ accountId: 'acc-123' }) });
        
        expect(response.status).toBe(200);
        
        expect(prisma.bankAccount.findFirst).toHaveBeenCalledWith({
            where: { id: 'acc-123', companyId: 'company-a' }
        });
        
        expect(prisma.bankAccount.update).toHaveBeenCalledWith({
            where: { id: 'acc-123' },
            data: { role: 'payroll' }
        });
    });
});
