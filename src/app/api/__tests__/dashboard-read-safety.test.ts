import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as dashboardGET } from "@/app/api/dashboard/route";
import * as tenant from "@/lib/tenant";
import prisma from "@/db/prisma";

vi.mock("@/db/prisma", () => {
    return {
        default: {
            company: { findUnique: vi.fn().mockResolvedValue({ id: "1a7b36f5-8fe0-4c2b-9336-8420846270b5", name: "Test Company" }) },
            companyNote: { findMany: vi.fn().mockResolvedValue([]) },
            cashFlowCategory: { findMany: vi.fn().mockResolvedValue([]) },
            baselineVarianceLedger: { findMany: vi.fn().mockResolvedValue([]) },
            baselineSnapshot: { findUnique: vi.fn().mockResolvedValue(null) },
            importBatch: { findFirst: vi.fn().mockResolvedValue(null) },
            executionPlan: { findFirst: vi.fn().mockResolvedValue(null) },
            changeLog: { findMany: vi.fn().mockResolvedValue([]) },
            cashAdjustment: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
            cashFlowEntry: { deleteMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
        }
    }
});

vi.mock("@/services/forecast-assembly", () => ({
    assembleForecastData: vi.fn().mockResolvedValue({
        input: { adjustedOpeningCash: 10000, bankBalance: 10000, adjustmentsTotal: 0, asOfDate: new Date(), invoices: [], bills: [], recurring: [], assumptions: {}, oneTimeOutflows: [] },
        forecastResult: { weeks: [], expectedRunOutWeek: null, constraintWeek: null },
        organicForecast: { weeks: [] },
        baseline: { computedFrom: "bank", hasSufficientHistory: false, weeklyBuckets: [] },
        invoices: [],
        bills: [],
        cashSnapshot: { asOfDate: new Date() },
        cashAdjustments: [],
        invoicesRaw: [],
        billsRaw: [],
        assumptions: { paymentCurveJson: "{}" },
        overrides: [],
        recurring: [],
        customerProfiles: [],
        vendorProfiles: [],
        customerPaymentObs: [],
    })
}));

vi.mock("@/lib/tenant", () => ({
    resolveTenant: vi.fn()
}));

vi.mock("@clerk/nextjs/server", () => ({
    auth: () => ({ userId: "test-user", orgId: "org_test" })
}));

describe("Package 1A: Dashboard Read-Safety Test", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should perform zero database mutations on GET", async () => {
        const companyId = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
        vi.mocked(tenant.resolveTenant).mockResolvedValue(companyId);

        const req = new NextRequest(`http://localhost:3000/api/dashboard?companyId=${companyId}`);
        const res = await dashboardGET(req);
        
        expect(res.status).toBe(200);

        expect(prisma.cashAdjustment.create).not.toHaveBeenCalled();
        expect(prisma.cashFlowEntry.deleteMany).not.toHaveBeenCalled();
    });
});
