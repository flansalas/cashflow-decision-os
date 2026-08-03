import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveTenant } from '../tenant';
import prisma from '@/db/prisma';
import { NextRequest } from 'next/server';
import { auth } from '@clerk/nextjs/server';

vi.mock('@clerk/nextjs/server', () => ({
    auth: vi.fn(),
}));

vi.mock('@/db/prisma', () => ({
    default: {
        company: {
            findUnique: vi.fn(),
        },
    },
}));

describe('resolveTenant', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null if no session exists', async () => {
        vi.mocked(auth).mockResolvedValue({ userId: null, orgId: null } as any);
        const req = new NextRequest(new URL('http://localhost/api/test?companyId=123'));
        
        const tenantId = await resolveTenant(req);
        
        expect(tenantId).toBeNull();
        expect(prisma.company.findUnique).not.toHaveBeenCalled();
    });

    it('returns null if authenticated but no active org exists (no fallback)', async () => {
        vi.mocked(auth).mockResolvedValue({ userId: 'user_1', orgId: null } as any);
        const req = new NextRequest(new URL('http://localhost/api/test?companyId=123'));
        
        const tenantId = await resolveTenant(req);
        
        expect(tenantId).toBeNull();
        expect(prisma.company.findUnique).not.toHaveBeenCalled();
    });

    it('ignores URL companyId even if unauthenticated', async () => {
        vi.mocked(auth).mockRejectedValue(new Error('Outside Next context'));
        const req = new NextRequest(new URL('http://localhost/api/test?companyId=evil_id'));
        
        const tenantId = await resolveTenant(req);
        
        expect(tenantId).toBeNull();
        expect(prisma.company.findUnique).not.toHaveBeenCalled();
    });

    it('returns null if active org exists but has no matching clerkOrgId in database', async () => {
        vi.mocked(auth).mockResolvedValue({ userId: 'user_1', orgId: 'org_missing' } as any);
        vi.mocked(prisma.company.findUnique).mockResolvedValue(null);
        
        const tenantId = await resolveTenant();
        
        expect(tenantId).toBeNull();
        expect(prisma.company.findUnique).toHaveBeenCalledWith({
            where: { clerkOrgId: 'org_missing' },
            select: { id: true },
        });
    });

    it('returns company ID if active org matches clerkOrgId perfectly', async () => {
        vi.mocked(auth).mockResolvedValue({ userId: 'user_1', orgId: 'org_valid' } as any);
        vi.mocked(prisma.company.findUnique).mockResolvedValue({ id: 'valid_company_id' } as any);
        
        const tenantId = await resolveTenant();
        
        expect(tenantId).toBe('valid_company_id');
        expect(prisma.company.findUnique).toHaveBeenCalledWith({
            where: { clerkOrgId: 'org_valid' },
            select: { id: true },
        });
    });
});
