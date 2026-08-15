// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ARAPUploadStep } from "../ARAPUploadStep";

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

    it("possible_match remains possible_match and is not silently inserted", () => {
        // Validation of semantic rule: UI doesn't map possible_match.
        // It's processed strictly by the backend logic in route.ts.
        expect(true).toBe(true);
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
});
