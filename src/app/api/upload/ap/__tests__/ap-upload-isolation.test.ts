import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../route';
import { NextRequest } from 'next/server';

// Mock dependencies
vi.mock('@clerk/nextjs/server', () => ({
    auth: vi.fn().mockResolvedValue({ userId: 'test_user_123' })
}));

vi.mock('@/lib/tenant', () => ({
    resolveTenant: vi.fn().mockResolvedValue('test_tenant_123')
}));

// Mock Prisma
const mockPrisma = vi.hoisted(() => ({
    payableBill: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new_ap_1' }),
        update: vi.fn(),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    mappingProfile: {
        upsert: vi.fn().mockResolvedValue({})
    },
    companyNote: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn()
    }
}));

vi.mock('@/db/prisma', () => ({
    default: mockPrisma
}));

// Mock Vercel functions (simulating a crash/failure in waitUntil)
vi.mock('@vercel/functions', () => ({
    waitUntil: vi.fn().mockImplementation(() => {
        throw new Error('Simulated Vercel waitUntil failure');
    })
}));

// Mock AI reconciliation
vi.mock('@/services/ai-reconciliation', () => ({
    proposeReconciliations: vi.fn().mockRejectedValue(new Error('Simulated AI proposal failure'))
}));

describe('AP Upload Route - AI Isolation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns success for accounting import even if AI scheduling and execution completely fails', async () => {
        const req = new NextRequest('http://localhost/api/upload/ap', {
            method: 'POST',
            body: JSON.stringify({
                rows: [
                    { vendorName: 'Test Vendor', billNo: 'BILL-001', amountOpen: 50, status: 'open' }
                ],
                mappingJson: {}
            })
        });

        // Spy on console.error to ensure it logs the failure but doesn't crash the route
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await POST(req);
        
        expect(response.status).toBe(200);
        const data = await response.json();
        
        expect(data.ok).toBe(true);
        expect(data.imported).toBe(1);
        
        // Ensure database writes were attempted
        expect(mockPrisma.payableBill.create).toHaveBeenCalled();
        expect(mockPrisma.companyNote.create).toHaveBeenCalled();

        // Ensure errors were logged for the AI scheduling failure
        expect(consoleSpy).toHaveBeenCalledWith(
            "Failed to schedule AI Reconciliation via waitUntil:",
            expect.any(Error)
        );

        consoleSpy.mockRestore();
    });
});
