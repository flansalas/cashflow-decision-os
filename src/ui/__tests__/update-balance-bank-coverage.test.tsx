// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UpdateBalanceDialog } from "../UpdateBalanceDialog";
import type { BankCoverageStatus } from "../BankCoverageReview";

vi.mock("lucide-react", () => ({
    AlertTriangle: () => null,
    CheckCircle2: () => null,
    Inbox: () => null,
    Landmark: () => null,
    ShieldAlert: () => null,
    ShieldCheck: () => null,
    TrendingUp: () => null,
    Upload: () => null,
    X: () => null,
}));

vi.mock("@/ui/VarianceDriverPanel", () => ({ VarianceDriverPanel: () => null }));
vi.mock("@/ui/ARAPUploadStep", () => ({ ARAPUploadStep: () => <div>AR/AP uploader</div> }));
vi.mock("@/ui/BankUploadStep", () => ({ BankUploadStep: () => <div>Bank uploader</div> }));
vi.mock("@/ui/BankCoverageReview", () => ({
    BankCoverageReview: ({ onContinue }: { onContinue: (status: BankCoverageStatus) => void }) => (
        <div>
            <p>Inline account coverage review</p>
            <button onClick={() => onContinue({
                hasData: true,
                rowCount: 33,
                isVerified: true,
                coverageDetails: { uncoveredAccountIds: [] },
            })}>
                Finish coverage review
            </button>
        </div>
    ),
}));

describe("UpdateBalanceDialog bank coverage integration", () => {
    afterEach(() => {
        cleanup();
    });

    it("opens account coverage inside Step 2 and returns to the balance step with verified status", () => {
        render(
            <UpdateBalanceDialog
                currentBalance={500152.93}
                currentAdjustments={[]}
                companyId="company-a"
                priorWeekData={{
                    weekStart: "2026-08-16T00:00:00.000Z",
                    weekEnd: "2026-08-22T23:59:59.999Z",
                    endCashExpected: 444335,
                }}
                onSaved={vi.fn()}
                onCancel={vi.fn()}
            />
        );

        fireEvent.click(screen.getByRole("button", { name: /Skip AR\/AP/ }));
        expect(screen.getByRole("heading", { name: "Upload Bank Transactions" })).toBeDefined();

        fireEvent.click(screen.getByRole("button", { name: "Review Account Coverage" }));
        expect(screen.getByRole("heading", { name: "Review Bank Account Coverage" })).toBeDefined();
        expect(screen.getByText("Inline account coverage review")).toBeDefined();

        fireEvent.click(screen.getByRole("button", { name: "Finish coverage review" }));
        expect(screen.getByText("Check-in Terminal")).toBeDefined();
    });
});
