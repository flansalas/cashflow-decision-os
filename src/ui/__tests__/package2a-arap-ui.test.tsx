// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ARAPUploadStep } from "../ARAPUploadStep";
import { POST as arPost } from "@/app/api/upload/ar/route";
import { POST as apPost } from "@/app/api/upload/ap/route";
import { NextRequest } from "next/server";

vi.mock('@clerk/nextjs/server', () => ({
    auth: vi.fn().mockResolvedValue({ userId: 'test_user_123' })
}));

vi.mock('@/lib/tenant', () => ({
    resolveTenant: vi.fn().mockResolvedValue('test_tenant_123')
}));

const mockPrisma = vi.hoisted(() => ({
    receivableInvoice: { findMany: vi.fn().mockResolvedValue([]) },
    payableBill: { findMany: vi.fn().mockResolvedValue([]) },
    importBatch: { create: vi.fn().mockImplementation((args) => ({ id: "batch_1", ...args.data })) },
    stagedImportRow: { createMany: vi.fn() },
    mappingProfile: { upsert: vi.fn() },
    companyNote: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn().mockImplementation(async (cb) => {
        return await cb(mockPrisma);
    })
}));

vi.mock('@/db/prisma', () => ({
    default: mockPrisma
}));

vi.mock("lucide-react", () => ({
    Inbox: () => null,
    Upload: () => null,
    FolderOpen: () => null,
    FileSpreadsheet: () => null,
    Search: () => null,
    CheckCircle: () => null,
    CheckCircle2: () => null,
    ArrowRight: () => null,
    ArrowLeft: () => null,
    AlertTriangle: () => null,
    Pencil: () => null
}));

const mockFetch = vi.fn(async (url: string, options?: any) => {
    if (url.includes("/api/upload/mapping")) {
        return { ok: true, json: async () => ({ found: false, mappingJson: {} }) };
    }
    if (url.includes("/api/upload/ar")) {
        return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
});
global.fetch = mockFetch as any;

vi.mock("@/services/parseFile", () => ({
    parseFile: vi.fn(async (file: File) => ({
        fileName: file.name,
        headers: ["Invoice", "Customer", "Amount"],
        rows: [{ "Invoice": "INV-1", "Customer": "Acme", "Amount": "100" }],
        rowCount: 1,
    }))
}));

describe("Package 2A - AR/AP Upload UI Flow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it("possible_match remains possible_match and is not silently inserted", async () => {
        // 1. Backend: AR possible match is staged as possible_match, not new
        mockPrisma.receivableInvoice.findMany.mockResolvedValueOnce([
            { id: "ar_exist_1", companyId: "test_tenant_123", invoiceNo: "INV-100", customerName: "Old Corp", amountOpen: 500 }
        ]);
        const arReq = new NextRequest('http://localhost/api/upload/ar', {
            method: 'POST',
            body: JSON.stringify({
                rows: [{ invoiceNo: "INV-100", customerName: "New Corp", amountOpen: 500 }],
                mappingJson: {}
            })
        });
        const arRes = await arPost(arReq);
        expect(arRes.status).toBe(200);

        expect(mockPrisma.stagedImportRow.createMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.arrayContaining([
                expect.objectContaining({ conflictType: "possible_match", userDecision: null })
            ])
        }));

        // 2. Backend: AP possible match is staged as possible_match, not new
        mockPrisma.stagedImportRow.createMany.mockClear();
        mockPrisma.payableBill.findMany.mockResolvedValueOnce([
            { id: "ap_exist_1", companyId: "test_tenant_123", billNo: "BILL-200", vendorName: "Old Vendor", amountOpen: 1000 }
        ]);
        const apReq = new NextRequest('http://localhost/api/upload/ap', {
            method: 'POST',
            body: JSON.stringify({
                rows: [{ billNo: "BILL-200", vendorName: "New Vendor", amountOpen: 1000 }],
                mappingJson: {}
            })
        });
        const apRes = await apPost(apReq);
        expect(apRes.status).toBe(200);

        expect(mockPrisma.stagedImportRow.createMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.arrayContaining([
                expect.objectContaining({ conflictType: "possible_match", userDecision: null })
            ])
        }));

        // 3. UI Flow: Does not apply while unresolved, succeeds after valid decision
        const onDone = vi.fn();
        const { container } = render(<ARAPUploadStep companyId="test_tenant_123" onDone={onDone} />);

        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(["dummy"], "ar.csv", { type: "text/csv" });
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => expect(screen.getByText(/Review Column Mapping/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Review Column Mapping/i));

        await waitFor(() => expect(screen.getByText(/Preview Import/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Preview Import/i));

        await waitFor(() => expect(screen.getByText(/Confirm & Import/i)).toBeDefined());

        // Mock upload to return possible match
        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes("/mapping")) return { ok: true, json: async () => ({ found: false }) };
            if (url.includes("/api/upload/ar")) {
                return {
                    ok: true, json: async () => ({
                        ok: true, batchId: "batch_ar_pm", staged: 1, newCount: 0, dupeCount: 0, changedCount: 0, possibleMatchCount: 1, invalidCount: 0, reviewStatus: "staged"
                    })
                };
            }
            if (url.includes("/api/upload/review")) {
                return {
                    ok: true,
                    json: async () => ({
                        rows: [
                            {
                                id: "pm_row_1",
                                conflictType: "possible_match",
                                matchedRecordId: "ar_exist_1",
                                normalizedValues: { invoiceNo: "INV-100", customerName: "New Corp", amountOpen: 500 },
                                candidates: [{ id: "ar_exist_1", invoiceNo: "INV-100", customerName: "Old Corp", amountOpen: 500 }]
                            }
                        ]
                    })
                };
            }
            if (url.includes("/api/upload/decide")) {
                return { ok: true, json: async () => ({ ok: true }) };
            }
            if (url.includes("/api/upload/apply")) {
                return { ok: true, json: async () => ({ ok: true }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        fireEvent.click(screen.getByText(/Confirm & Import/i));

        // Wait for Review Phase and possible matches to load
        await waitFor(() => expect(screen.getByText(/Approve & Apply/i)).toBeDefined());
        await waitFor(() => expect(screen.getByText(/Invoice: INV-100/i)).toBeDefined());
        expect(screen.getByText(/1 possible matches require manual resolution/i)).toBeDefined();

        // Apply button should be disabled because the row is unresolved
        const applyBtn = screen.getByText(/Approve & Apply/i).closest("button");
        expect(applyBtn?.disabled).toBe(true);

        // Click Use existing match
        fireEvent.click(screen.getByText(/Use existing match/i));

        // Now Apply button should be enabled
        expect(applyBtn?.disabled).toBe(false);

        // Click Apply
        mockFetch.mockClear();

        // Mock apply again because we cleared mockFetch
        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes("/api/upload/decide") || url.includes("/api/upload/apply")) {
                return { ok: true, json: async () => ({ ok: true }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        fireEvent.click(screen.getByText(/Approve & Apply/i));

        // Assert decide was called with link_and_review
        await waitFor(() => {
            const decideCalls = mockFetch.mock.calls.filter(c => c[0].includes("/api/upload/decide"));
            expect(decideCalls.length).toBeGreaterThan(0);
            const rowDecision = JSON.parse(decideCalls[0][1].body);
            expect(rowDecision).toMatchObject({
                rowId: "pm_row_1",
                decision: "link_and_review",
                linkedRecordId: "ar_exist_1"
            });
        });

        // Should reach Done Phase
        await waitFor(() => expect(screen.getByText(/Import Complete/i)).toBeDefined());
    });

    it("changed_existing -> explicit accept_update -> apply succeeds", async () => {
        const onDone = vi.fn();
        const { container } = render(<ARAPUploadStep companyId="c_test" onDone={onDone} />);

        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(["dummy"], "ar.csv", { type: "text/csv" });
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => expect(screen.getByText(/Review Column Mapping/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Review Column Mapping/i));

        await waitFor(() => expect(screen.getByText(/Preview Import/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Preview Import/i));

        await waitFor(() => expect(screen.getByText(/Confirm & Import/i)).toBeDefined());

        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes("/mapping")) return { ok: true, json: async () => ({ found: false }) };
            if (url.includes("/api/upload/ar")) {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        batchId: "ar_batch_1",
                        staged: 1,
                        newCount: 0,
                        dupeCount: 0,
                        changedCount: 1,
                        invalidCount: 0,
                        reviewStatus: "staged"
                    })
                };
            }
            if (url.includes("/api/upload/decide") || url.includes("/api/upload/apply")) {
                return { ok: true, json: async () => ({ ok: true }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        fireEvent.click(screen.getByText(/Confirm & Import/i));

        // UI should transition to Review phase
        await waitFor(() => expect(screen.getByText(/Approve & Apply/i)).toBeDefined());

        // mock overrides are handled above

        fireEvent.click(screen.getByText(/Approve & Apply/i));

        // Wait for Done phase
        await waitFor(() => expect(screen.getByText(/Import Complete/i)).toBeDefined());

        // Assert fetch calls
        const decideCall = mockFetch.mock.calls.find(c => c[0] === "/api/upload/decide");
        expect(decideCall).toBeDefined();
        const decideBody = JSON.parse(decideCall![1].body);
        expect(decideBody.action).toBe("accept_changed_existing");
        expect(decideBody.batchId).toBe("ar_batch_1");

        const applyCall = mockFetch.mock.calls.find(c => c[0] === "/api/upload/apply");
        expect(applyCall).toBeDefined();
    });

    it("failed /api/upload/apply -> UI does NOT show Done", async () => {
        const onDone = vi.fn();
        const { container } = render(<ARAPUploadStep companyId="c_test" onDone={onDone} />);

        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(["dummy"], "ar.csv", { type: "text/csv" });
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => expect(screen.getByText(/Review Column Mapping/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Review Column Mapping/i));

        await waitFor(() => expect(screen.getByText(/Preview Import/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Preview Import/i));

        await waitFor(() => expect(screen.getByText(/Confirm & Import/i)).toBeDefined());

        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes("/mapping")) return { ok: true, json: async () => ({ found: false }) };
            if (url.includes("/api/upload/ar")) {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        batchId: "ar_batch_2",
                        staged: 1,
                        newCount: 1,
                        dupeCount: 0,
                        changedCount: 0,
                        invalidCount: 0,
                        reviewStatus: "ready_to_apply"
                    })
                };
            }
            if (url.includes("/api/upload/apply")) {
                return { ok: false, json: async () => ({ error: "Apply crashed" }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        fireEvent.click(screen.getByText(/Confirm & Import/i));

        // It should NOT show Done. It should show the error.
        await waitFor(() => expect(screen.getByText(/Apply crashed/i)).toBeDefined());
        expect(screen.queryByText(/Import Complete/i)).toBeNull();
    });

    it("successful clean batch reaches Done only after successful apply", async () => {
        const onDone = vi.fn();
        const { container } = render(<ARAPUploadStep companyId="c_test" onDone={onDone} />);

        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        const file = new File(["dummy"], "ar.csv", { type: "text/csv" });
        fireEvent.change(fileInput, { target: { files: [file] } });

        await waitFor(() => expect(screen.getByText(/Review Column Mapping/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Review Column Mapping/i));

        await waitFor(() => expect(screen.getByText(/Preview Import/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Preview Import/i));

        await waitFor(() => expect(screen.getByText(/Confirm & Import/i)).toBeDefined());

        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes("/mapping")) return { ok: true, json: async () => ({ found: false }) };
            if (url.includes("/api/upload/ar")) {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        batchId: "ar_batch_3",
                        staged: 1,
                        newCount: 1,
                        dupeCount: 0,
                        changedCount: 0,
                        invalidCount: 0,
                        reviewStatus: "ready_to_apply"
                    })
                };
            }
            if (url.includes("/api/upload/apply")) {
                return { ok: true, json: async () => ({ ok: true }) };
            }
            return { ok: true, json: async () => ({}) };
        });

        fireEvent.click(screen.getByText(/Confirm & Import/i));

        await waitFor(() => expect(screen.getByText(/Import Complete/i)).toBeDefined());

        const applyCall = mockFetch.mock.calls.find(c => c[0] === "/api/upload/apply" && JSON.parse(c[1].body).importBatchId === "ar_batch_3");
        expect(applyCall).toBeDefined();
    });

    it("retries a transient tenant 403 only after the authenticated tenant matches", async () => {
        const onDone = vi.fn();
        const { container } = render(<ARAPUploadStep companyId="c_test" onDone={onDone} />);

        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(fileInput, { target: { files: [new File(["dummy"], "ar.csv", { type: "text/csv" })] } });

        await waitFor(() => expect(screen.getByText(/Review Column Mapping/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Review Column Mapping/i));
        await waitFor(() => expect(screen.getByText(/Preview Import/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Preview Import/i));
        await waitFor(() => expect(screen.getByText(/Confirm & Import/i)).toBeDefined());

        let stageAttempts = 0;
        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes("/mapping")) return { ok: true, status: 200, json: async () => ({ found: false }) };
            if (url === "/api/upload/ar") {
                stageAttempts++;
                if (stageAttempts === 1) {
                    return { ok: false, status: 403, json: async () => ({ error: "Forbidden" }) };
                }
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        batchId: "ar_batch_retry",
                        staged: 1,
                        newCount: 1,
                        changedCount: 0,
                        possibleMatchCount: 0,
                    }),
                };
            }
            if (url === "/api/company/status") {
                return { ok: true, status: 200, json: async () => ({ exists: true, companyId: "c_test" }) };
            }
            if (url === "/api/upload/apply") {
                return { ok: true, status: 200, json: async () => ({ ok: true }) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        });

        fireEvent.click(screen.getByText(/Confirm & Import/i));

        await waitFor(() => expect(screen.getByText(/Import Complete/i)).toBeDefined());
        expect(stageAttempts).toBe(2);
        expect(mockFetch.mock.calls.some(c => c[0] === "/api/company/status")).toBe(true);
    });

    it("blocks a tenant retry when the authenticated company differs", async () => {
        const onDone = vi.fn();
        const { container } = render(<ARAPUploadStep companyId="c_stale" onDone={onDone} />);

        const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(fileInput, { target: { files: [new File(["dummy"], "ar.csv", { type: "text/csv" })] } });

        await waitFor(() => expect(screen.getByText(/Review Column Mapping/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Review Column Mapping/i));
        await waitFor(() => expect(screen.getByText(/Preview Import/i)).toBeDefined());
        fireEvent.click(screen.getByText(/Preview Import/i));
        await waitFor(() => expect(screen.getByText(/Confirm & Import/i)).toBeDefined());

        mockFetch.mockImplementation(async (url: string) => {
            if (url.includes("/mapping")) return { ok: true, status: 200, json: async () => ({ found: false }) };
            if (url === "/api/upload/ar") {
                return { ok: false, status: 403, json: async () => ({ error: "Forbidden" }) };
            }
            if (url === "/api/company/status") {
                return { ok: true, status: 200, json: async () => ({ exists: true, companyId: "c_other" }) };
            }
            return { ok: true, status: 200, json: async () => ({}) };
        });

        fireEvent.click(screen.getByText(/Confirm & Import/i));

        await waitFor(() => expect(screen.getByText(/Your company session changed/i)).toBeDefined());
        expect(screen.queryByText(/Import Complete/i)).toBeNull();
        expect(mockFetch.mock.calls.filter(c => c[0] === "/api/upload/ar")).toHaveLength(1);
        expect(mockFetch.mock.calls.some(c => c[0] === "/api/upload/apply")).toBe(false);
    });
});
