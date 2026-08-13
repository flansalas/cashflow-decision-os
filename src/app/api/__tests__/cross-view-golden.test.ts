import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as dashboardGET } from "@/app/api/dashboard/route";
import { GET as gridGET } from "@/app/api/cashflow-grid/route";
import * as tenant from "@/lib/tenant";
import * as assembly from "@/services/forecast-assembly";

vi.mock("@/lib/tenant", () => ({
    resolveTenant: vi.fn()
}));

vi.mock("@clerk/nextjs/server", () => ({
    auth: () => ({ userId: "test-user", orgId: "org_test" })
}));

vi.mock("@/db/prisma", () => ({
    default: {
        company: { findUnique: vi.fn().mockResolvedValue({ id: "1a7b36f5-8fe0-4c2b-9336-8420846270b5", name: "Test Company" }) },
        companyNote: { findMany: vi.fn().mockResolvedValue([]) },
        cashFlowCategory: { findMany: vi.fn().mockResolvedValue([]) },
        baselineVarianceLedger: { findMany: vi.fn().mockResolvedValue([]) },
        baselineSnapshot: { findUnique: vi.fn().mockResolvedValue(null) },
        importBatch: { findFirst: vi.fn().mockResolvedValue(null) },
        executionPlan: { findFirst: vi.fn().mockResolvedValue(null) },
        changeLog: { findMany: vi.fn().mockResolvedValue([]) },
    }
}));

// We mock assembleForecastData to return a deterministic canonical state
vi.mock("@/services/forecast-assembly", () => ({
    assembleForecastData: vi.fn()
}));

describe("Package 1A: Cross-View Golden Test & Semantic Grid Derivation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should produce identical W1-W13 economics and prove grid values derive purely from canonical processed state", async () => {
        const companyId = "1a7b36f5-8fe0-4c2b-9336-8420846270b5";
        vi.mocked(tenant.resolveTenant).mockResolvedValue(companyId);

        // Define a raw invoice with $100k open amount
        const rawInvoice = {
            id: "inv_1",
            customerName: "Corp A",
            invoiceNo: "1001",
            amountOpen: 100000,
            status: "open"
        };
        
        const rawHiddenInvoice = {
            id: "inv_hidden",
            customerName: "Corp B",
            invoiceNo: "9999",
            amountOpen: 50000,
            status: "open"
        };

        const rawBill = {
            id: "bill_1",
            vendorName: "Vendor X",
            billNo: "5555",
            amountOpen: 25000,
            status: "open"
        };

        const rawMarkedPaidInvoice = {
            id: "inv_paid",
            customerName: "Corp Paid",
            invoiceNo: "1112",
            amountOpen: 75000,
            status: "open"
        };

        const rawMarkedPaidBill = {
            id: "bill_paid",
            vendorName: "Vendor Paid",
            billNo: "5556",
            amountOpen: 25000,
            status: "open"
        };

        const rawReconciledInvoice = {
            id: "inv_recon",
            customerName: "Corp C",
            invoiceNo: "1111",
            amountOpen: 30000,
            status: "open"
        };

        // The canonical input after deductions (ReconciliationLink) and overrides
        // E.g., it was partially reconciled for 40k, leaving 60k canonical amountOpen
        const canonicalInvoice = {
            id: "inv_1",
            customerName: "Corp A",
            invoiceNo: "1001",
            amountOpen: 60000,
            status: "open",
            overrideAmount: 50000,
            partialPayment: 10000, // Explicitly marked as a partial payment
            overrideExpectedDate: new Date("2026-08-15T00:00:00.000Z"),
        };

        const canonicalBill = {
            id: "bill_1",
            vendorName: "Vendor X",
            billNo: "5555",
            amountOpen: 80000,
            status: "open",
            overrideAmount: 55000,
            overrideDueDate: new Date("2026-08-29T00:00:00.000Z"),
        };

        const canonicalMarkedPaidInvoice = {
            id: "inv_paid",
            customerName: "Corp Paid",
            invoiceNo: "1112",
            amountOpen: 75000,
            status: "open",
            markedPaid: true,
        };

        const canonicalMarkedPaidBill = {
            id: "bill_paid",
            vendorName: "Vendor Paid",
            billNo: "5556",
            amountOpen: 25000,
            status: "open",
            markedPaid: true,
        };

        // Note: inv_recon is fully reconciled, so it doesn't appear in canonical items!

        const overrides = [
            { targetId: "inv_1", targetType: "invoice", type: "set_expected_payment_date", effectiveDate: new Date("2026-08-15T00:00:00.000Z") },
            { targetId: "inv_hidden", targetType: "invoice", type: "exclude" },
            { targetId: "bill_1", targetType: "bill", type: "set_bill_due_date", effectiveDate: new Date("2026-08-29T00:00:00.000Z") },
            { targetId: "inv_paid", targetType: "invoice", type: "mark_paid" },
            { targetId: "bill_paid", targetType: "bill", type: "mark_paid" }
        ];

        const today = new Date("2026-08-01T00:00:00.000Z");

        const forecastInput = {
            adjustedOpeningCash: 10000,
            bankBalance: 10000,
            adjustmentsTotal: 0,
            asOfDate: today,
            invoices: [canonicalInvoice, canonicalMarkedPaidInvoice], // Canonical processed items only
            bills: [canonicalBill, canonicalMarkedPaidBill],
            recurring: [],
            assumptions: { bufferMin: 10000, payrollCadence: "biweekly", paymentCurveJson: "{}" },
            oneTimeOutflows: []
        };

        // Use the REAL computeForecast to avoid mock drift!
        // We import dynamically or just require it so we don't need a top level import
        const { computeForecast } = await import("@/services/forecast");
        const dummyForecastResult = computeForecast(forecastInput as any);

        const dummyAssemblyResult = {
            input: forecastInput,
            forecastResult: dummyForecastResult,
            organicForecast: dummyForecastResult,
            baseline: {
                computedFrom: "bank",
                hasSufficientHistory: true,
                weeksAnalyzed: 26,
                variableOutflowWeekly: 5000,
                variableInflowWeekly: 10000,
                conservativeInflowWeekly: 8000,
                conservativeOutflowWeekly: 6000,
                weeklyBuckets: []
            },
            invoices: [canonicalInvoice, canonicalMarkedPaidInvoice],
            bills: [canonicalBill, canonicalMarkedPaidBill],
            cashSnapshot: { asOfDate: today },
            cashAdjustments: [],
            invoicesRaw: [rawInvoice, rawHiddenInvoice, rawReconciledInvoice, rawMarkedPaidInvoice], // Raw includes hidden/reconciled
            billsRaw: [rawBill, rawMarkedPaidBill],
            assumptions: { paymentCurveJson: "{}" },
            overrides: overrides,
            recurring: [],
            customerProfiles: [],
            vendorProfiles: [],
            customerPaymentObs: [],
        };

        vi.mocked(assembly.assembleForecastData).mockResolvedValue(dummyAssemblyResult as any);

        // 1. Fetch from Dashboard API
        const reqDash = new NextRequest(`http://localhost:3000/api/dashboard?companyId=${companyId}`);
        const resDash = await dashboardGET(reqDash);
        expect(resDash.status).toBe(200);
        const dataDash = await resDash.json();

        // 2. Fetch from Grid API
        const reqGrid = new NextRequest(`http://localhost:3000/api/cashflow-grid?companyId=${companyId}`);
        const resGrid = await gridGET(reqGrid);
        expect(resGrid.status).toBe(200);
        const dataGrid = await resGrid.json();

        // --- ASSERTIONS FOR CANONICAL GRID DERIVATION ---

        const gridInvoices = dataGrid.invoices;
        const gridBills = dataGrid.bills;
        const visibleInvoice = gridInvoices.find((i: any) => i.id === "inv_1");
        const hiddenInvoice = gridInvoices.find((i: any) => i.id === "inv_hidden");
        const reconciledInvoice = gridInvoices.find((i: any) => i.id === "inv_recon");
        const visibleBill = gridBills.find((b: any) => b.id === "bill_1");
        const markedPaidInvoice = gridInvoices.find((i: any) => i.id === "inv_paid");
        const markedPaidBill = gridBills.find((b: any) => b.id === "bill_paid");

        expect(visibleInvoice).toBeDefined();
        expect(hiddenInvoice).toBeDefined();
        expect(visibleBill).toBeDefined();

        // fully reconciled items MUST NOT reappear as active $0 Backlog items
        expect(reconciledInvoice).toBeUndefined();
        
        // marked paid items MUST NOT appear in grid output at all
        expect(markedPaidInvoice).toBeUndefined();
        expect(markedPaidBill).toBeUndefined();

        // 1. Grid-visible managerially active amount/timing equals the canonical processed economic state
        // AR: canonical amountOpen 60000, overrideAmount 50000, partialPayment 10000 => 40000
        expect(visibleInvoice.amountOpen).toBe(40000); 
        expect(visibleInvoice.originalAmount).toBe(100000);

        // AP: canonical amountOpen 80000, overrideAmount 55000 => 55000
        expect(visibleBill.amountOpen).toBe(55000);
        
        // 2. The expected date comes from the canonical processed state
        expect(new Date(visibleInvoice.expectedDate).getTime()).toBe(new Date("2026-08-15T00:00:00.000Z").getTime());
        
        // 3. The effective week is perfectly aligned with the forecast breakdown using correct sourceId and sourceType
        // 2026-08-15 lands in W3 (Aug 1 - Aug 2 is W1, Aug 3 - Aug 9 is W2, Aug 10 - Aug 16 is W3)
        expect(visibleInvoice.effectiveWeek).toBe(3);
        
        // And the bill expected on 2026-08-29 should land in W5 (Aug 24 - Aug 30)
        expect(visibleBill.effectiveWeek).toBe(5);

        // Neither should be in backlog semantics (which uses effectiveWeek = null)
        expect(visibleInvoice.effectiveWeek).not.toBeNull();
        expect(visibleBill.effectiveWeek).not.toBeNull();

        // 4. Hidden records do not affect managerial totals (marked as excluded)
        expect(hiddenInvoice.isExcluded).toBe(true);
        expect(hiddenInvoice.amountOpen).toBe(0); // Canonical amountOpen is 0 if excluded

        // 5. Dashboard/Grid W1-W13 totals match
        expect(dataDash.forecast.weeks.length).toBe(13);
        expect(dataGrid.forecast.weeks.length).toBe(13);

        for (let i = 0; i < 13; i++) {
            const wD = dataDash.forecast.weeks[i];
            const wG = dataGrid.forecast.weeks[i];
            
            expect(wG.weekNumber).toBe(wD.weekNumber);
            expect(wG.startCash).toBeCloseTo(wD.startCash);
            expect(wG.endCashExpected).toBeCloseTo(wD.endCashExpected);
            expect(wG.inflowsExpected).toBeCloseTo(wD.inflowsExpected);
            expect(wG.outflowsExpected).toBeCloseTo(wD.outflowsExpected);
        }
    });
});
