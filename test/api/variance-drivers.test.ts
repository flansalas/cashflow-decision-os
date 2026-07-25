import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../../src/app/api/variance-drivers/route";

const mockResolveTenant = vi.fn();
const mockComputeVarianceDrivers = vi.fn();
const mockGetDeterministicVarianceDrivers = vi.fn();

vi.mock("../../src/lib/tenant", () => ({
    resolveTenant: () => mockResolveTenant(),
}));

vi.mock("../../src/db/prisma", () => ({
    default: {
        forecastCheckpoint: {
            findFirst: vi.fn(),
        }
    }
}));

vi.mock("../../src/services/variance-drivers", () => ({
    computeVarianceDrivers: (...args: any[]) => mockComputeVarianceDrivers(...args),
}));

vi.mock("../../src/services/deterministic-variance", () => ({
    getDeterministicVarianceDrivers: (...args: any[]) => mockGetDeterministicVarianceDrivers(...args),
}));

describe("GET /api/variance-drivers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockResolveTenant.mockResolvedValue("comp-123");
    });

    function createReq(url: string) {
        return new NextRequest(new URL(url, "http://localhost"));
    }

    test("Legacy week returns isDeterministic: false", async () => {
        mockGetDeterministicVarianceDrivers.mockResolvedValue(null);
        mockComputeVarianceDrivers.mockResolvedValue({ totalVariance: -500, checkpointId: "chk-1" });

        const req = createReq("/api/variance-drivers?checkpointId=chk-1");
        const res = await GET(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.isDeterministic).toBe(false);
        expect(data.totalVariance).toBe(-500);
        expect(mockComputeVarianceDrivers).toHaveBeenCalledWith("chk-1", "comp-123");
    });

    test("Deterministic week returns deterministic result", async () => {
        mockGetDeterministicVarianceDrivers.mockResolvedValue({
            isDeterministic: true,
            checkpointId: "chk-2",
            groups: []
        });

        const req = createReq("/api/variance-drivers?checkpointId=chk-2");
        const res = await GET(req);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.isDeterministic).toBe(true);
        expect(data.checkpointId).toBe("chk-2");
        expect(mockComputeVarianceDrivers).not.toHaveBeenCalled();
    });
});
