import { describe, it, expect, afterEach } from "vitest";
import { validateBankFile } from "./validate-backtest-file";
import * as fs from "fs";
import * as path from "path";

describe("validateBankFile", () => {
    const testCsvPath = path.join(__dirname, "test-mock-bank.csv");

    afterEach(() => {
        if (fs.existsSync(testCsvPath)) {
            fs.unlinkSync(testCsvPath);
        }
    });

    it("should correctly parse a simple valid CSV and calculate origins", () => {
        const csvData = [
            "Date,Amount,Description,Account",
            "2023-01-02,-500,Rent,Main Checking", // A Monday
            "2023-01-05,1000,Client Payment,Main Checking",
            // Jump 20 weeks ahead to test gaps
            "2023-05-22,-200,Utilities,Main Checking", 
            "2023-05-22,-200,Utilities,Main Checking" // Duplicate
        ].join("\n");
        
        fs.writeFileSync(testCsvPath, csvData);
        
        const result = validateBankFile(testCsvPath);
        
        expect(result.totalRows).toBe(4);
        expect(result.exactDuplicates.length).toBe(1); // 1 group of duplicates
        expect(result.gaps.length).toBe(1); // 1 gap > 14 days
        expect(result.gaps[0].days).toBeGreaterThan(100);
        expect(result.totalCompleteCalendarWeeks).toBe(20); 
        expect(result.overallCompleteness).toBe("Unverified"); // Due to gaps
    });

    it("should identify confirmed internal transfers and unresolved transfers", () => {
        const csvData = [
            "Date,Amount,Description,Account",
            "2023-01-02,-500,Transfer to Savings,Main",
            "2023-01-03,500,Transfer from Checking,Savings",
            "2023-01-05,-200,External Transfer,Main", // Unmatched
            "2023-01-06,-300,Zelle to John,Main",
            "2023-01-07,300,Zelle from John,Main" // Matched Zero-sum
        ].join("\n");
        
        fs.writeFileSync(testCsvPath, csvData);
        
        const result = validateBankFile(testCsvPath);
        
        expect(result.confirmedInternalPairs).toBe(2); // Two pairs matched (500 and 300)
        expect(result.unresolvedOrProbable).toBe(1); // One unmatched (-200)
    });
});
