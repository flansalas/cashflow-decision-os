import { computeForecast } from "./src/services/forecast";

computeForecast({
    adjustedOpeningCash: 1000,
    bankBalance: 1000,
    adjustmentsTotal: 0,
    asOfDate: new Date(),
    invoices: [],
    bills: [],
    recurring: [],
    assumptions: { bufferMin: 1000, paymentCurveJson: '{}' } as any,
    hasBankBaseline: false,
    variableOutflowWeekly: 0,
    variableOutflowBand: 0,
    baselineInflowWeekly: 0,
    baselineInflowBand: 0,
    cashFlowEntries: [
        {
            categoryId: "test",
            categoryName: "test",
            direction: "inflow",
            label: "test",
            amount: 100,
            targetDate: undefined as any // simulate missing targetDate
        }
    ],
});
console.log("Success");
