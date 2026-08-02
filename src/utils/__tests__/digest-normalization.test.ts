import { describe, it, expect } from "vitest";

// Simulate the exact hashing logic used in src/ui/BankUploadStep.tsx
const generateFileHash = async (bankRows: any[]) => {
    if (bankRows.length === 0) return Date.now().toString();
    const msgBuffer = new TextEncoder().encode(JSON.stringify(bankRows));
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

describe("Digest Normalization Behavior", () => {
    const baseRows = [
        { Date: "2023-01-01", Amount: 100.0, Description: "Test 1" },
        { Date: "2023-01-02", Amount: -50.0, Description: "Test 2" }
    ];

    it("equivalent normalized rows produce the same hash", async () => {
        const hash1 = await generateFileHash(baseRows);
        const hash2 = await generateFileHash([
            { Date: "2023-01-01", Amount: 100.0, Description: "Test 1" },
            { Date: "2023-01-02", Amount: -50.0, Description: "Test 2" }
        ]);
        expect(hash1).toBe(hash2);
    });

    it("a one-cent change produces a different hash", async () => {
        const hash1 = await generateFileHash(baseRows);
        const modifiedRows = [
            { Date: "2023-01-01", Amount: 100.0, Description: "Test 1" },
            { Date: "2023-01-02", Amount: -50.01, Description: "Test 2" } // 1 cent change
        ];
        const hash2 = await generateFileHash(modifiedRows);
        expect(hash1).not.toBe(hash2);
    });

    it("row order changes the hash", async () => {
        const hash1 = await generateFileHash(baseRows);
        const reorderedRows = [
            { Date: "2023-01-02", Amount: -50.0, Description: "Test 2" },
            { Date: "2023-01-01", Amount: 100.0, Description: "Test 1" }
        ];
        const hash2 = await generateFileHash(reorderedRows);
        expect(hash1).not.toBe(hash2);
    });
});
