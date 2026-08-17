import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
    const tx = {
        stagedImportRow: {
            findMany: vi.fn(),
            update: vi.fn().mockResolvedValue({}),
        },
        receivableInvoice: {
            create: vi.fn(),
            findUnique: vi.fn(),
            update: vi.fn(),
        },
        payableBill: {
            create: vi.fn(),
            findUnique: vi.fn(),
            update: vi.fn(),
        },
        changeLog: {
            create: vi.fn().mockResolvedValue({ id: "change-log-1" }),
        },
        importApplication: {
            create: vi.fn().mockResolvedValue({
                id: "application-1",
                changeLogId: "change-log-1",
            }),
        },
        importApplyChange: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
        },
        importBatch: {
            update: vi.fn().mockResolvedValue({}),
        },
    };

    const prisma = {
        importBatch: {
            findFirst: vi.fn(),
        },
        importApplication: {
            update: vi.fn().mockResolvedValue({}),
        },
        changeLog: {
            update: vi.fn().mockResolvedValue({}),
        },
        $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };

    return { prisma, tx };
});

vi.mock("@clerk/nextjs/server", () => ({
    auth: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));

vi.mock("@/lib/tenant", () => ({
    resolveTenant: vi.fn().mockResolvedValue("company-1"),
}));

vi.mock("@/db/prisma", () => ({
    default: mocks.prisma,
}));

vi.mock("@/services/forecast-assembly", () => ({
    assembleForecastData: vi.fn().mockResolvedValue({
        forecastResult: { forecastVersionHash: "forecast-hash" },
    }),
}));

vi.mock("@/services/variance-sync", () => ({
    syncVarianceLedger: vi.fn().mockResolvedValue(undefined),
}));

import { POST } from "../route";

describe("upload apply route sanitization", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.tx.stagedImportRow.update.mockResolvedValue({});
        mocks.tx.changeLog.create.mockResolvedValue({ id: "change-log-1" });
        mocks.tx.importApplication.create.mockResolvedValue({
            id: "application-1",
            changeLogId: "change-log-1",
        });
        mocks.tx.importApplyChange.createMany.mockResolvedValue({ count: 2 });
        mocks.tx.importBatch.update.mockResolvedValue({});
        mocks.prisma.importApplication.update.mockResolvedValue({});
        mocks.prisma.changeLog.update.mockResolvedValue({});
        mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.tx));
    });

    it.each([
        {
            importType: "ar",
            naturalFields: {
                customerName: "Customer One",
                invoiceNo: "INV-1",
                amountOpen: 125,
                invoiceDate: "2026-08-01",
                dueDate: "2026-08-15",
                status: "open",
            },
            model: "receivableInvoice" as const,
        },
        {
            importType: "ap",
            naturalFields: {
                vendorName: "Vendor One",
                billNo: "BILL-1",
                amountOpen: 75,
                billDate: "2026-08-01",
                dueDate: "2026-08-15",
                status: "open",
            },
            model: "payableBill" as const,
        },
    ])("removes _raw before $importType insert and update", async ({ importType, naturalFields, model }) => {
        const modelMock = mocks.tx[model];
        modelMock.create.mockResolvedValue({ id: `${importType}-new`, ...naturalFields });
        modelMock.findUnique.mockResolvedValue({ id: `${importType}-existing`, ...naturalFields, amountOpen: 50 });
        modelMock.update.mockResolvedValue({ id: `${importType}-existing`, ...naturalFields });

        mocks.prisma.importBatch.findFirst.mockResolvedValue({
            id: `${importType}-batch`,
            companyId: "company-1",
            importType,
            status: "staged",
            application: null,
        });

        const normalizedDataJson = JSON.stringify({
            ...naturalFields,
            _raw: { source: "spreadsheet-only metadata" },
        });

        mocks.tx.stagedImportRow.findMany.mockResolvedValue([
            {
                id: `${importType}-insert-row`,
                sourceRowNumber: 1,
                normalizedDataJson,
                conflictType: "new",
                userDecision: "accept_insert",
                matchedRecordId: null,
                linkedRecordId: null,
            },
            {
                id: `${importType}-update-row`,
                sourceRowNumber: 2,
                normalizedDataJson,
                conflictType: "changed_existing",
                userDecision: "accept_update",
                matchedRecordId: `${importType}-existing`,
                linkedRecordId: null,
            },
        ]);

        const response = await POST(new NextRequest("http://localhost/api/upload/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ importBatchId: `${importType}-batch` }),
        }));

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ insertedCount: 1, updatedCount: 1 });

        const createData = modelMock.create.mock.calls[0][0].data;
        const updateData = modelMock.update.mock.calls[0][0].data;
        const expectedData = Object.fromEntries(
            Object.entries(naturalFields).map(([key, value]) => [
                key,
                ["dueDate", "invoiceDate", "billDate"].includes(key) && typeof value === "string"
                    ? new Date(`${value}T00:00:00.000Z`)
                    : value,
            ]),
        );

        expect(createData).not.toHaveProperty("_raw");
        expect(updateData).not.toHaveProperty("_raw");
        expect(createData).toMatchObject({ ...expectedData, companyId: "company-1" });
        expect(updateData).toMatchObject(expectedData);
    });
});
