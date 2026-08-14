import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET as dashboardGET } from "@/app/api/dashboard/route";
import { GET as gridGET } from "@/app/api/cashflow-grid/route";
import { GET as reviewGET } from "@/app/api/review/route";
import * as tenant from "@/lib/tenant";

vi.mock("@/lib/tenant", () => ({
    resolveTenant: vi.fn()
}));

vi.mock("@clerk/nextjs/server", () => ({
    auth: () => ({ userId: "test-user", orgId: "org_test" })
}));

describe("Package 1A: Tenant Boundary Test", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should reject access when requestedCompanyId does not match resolved tenant ID", async () => {
        // Authenticated tenant
        const authorizedTenantId = "tenant-123";
        vi.mocked(tenant.resolveTenant).mockResolvedValue(authorizedTenantId);

        // Requesting data for a different tenant
        const requestedCompanyId = "tenant-456";

        // Dashboard
        const reqDash = new NextRequest(`http://localhost:3000/api/dashboard?companyId=${requestedCompanyId}`);
        const resDash = await dashboardGET(reqDash);
        expect(resDash.status).toBe(403);
        const dashError = await resDash.json();
        expect(dashError.error).toMatch(/Forbidden/);

        // Grid
        const reqGrid = new NextRequest(`http://localhost:3000/api/cashflow-grid?companyId=${requestedCompanyId}`);
        const resGrid = await gridGET(reqGrid);
        expect(resGrid.status).toBe(403);
        const gridError = await resGrid.json();
        expect(gridError.error).toMatch(/Forbidden/);

        // Review
        const reqReview = new NextRequest(`http://localhost:3000/api/review?companyId=${requestedCompanyId}`);
        const resReview = await reviewGET(reqReview);
        expect(resReview.status).toBe(403);
        const reviewError = await resReview.json();
        expect(reviewError.error).toMatch(/Forbidden/);
    });
});
