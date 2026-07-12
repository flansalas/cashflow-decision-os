import fs from "fs";

const chartCode = fs.readFileSync("src/ui/ForecastChart.tsx", "utf-8");
const drawerCode = fs.readFileSync("src/ui/WeekDrawer.tsx", "utf-8");

function assert(condition: boolean, msg: string) {
    if (!condition) {
        console.error("FAIL:", msg);
        process.exit(1);
    }
    console.log("PASS:", msg);
}

// Check ForecastChart.tsx
assert(chartCode.includes("expected: Math.round(w.startCash)"), "ForecastChart expected line plots startCash");
assert(chartCode.includes("best: Math.round(startCashBest)"), "ForecastChart best line plots startCashBest");
assert(chartCode.includes("worst: Math.round(startCashWorst)"), "ForecastChart worst line plots startCashWorst");
assert(chartCode.includes("bandHigh: w.zone !== \"committed\" ? Math.round(startCashBest)"), "ForecastChart bandHigh plots startCashBest");
assert(chartCode.includes("bandLow: w.zone !== \"committed\" ? Math.round(startCashWorst)"), "ForecastChart bandLow plots startCashWorst");
assert(chartCode.includes("scenario: hasScenario ? Math.round(w.startCash + currentScenarioCashForStart)"), "ForecastChart scenario tracks startCash");
assert(chartCode.includes("planExpected = Math.round(planWeeks[idx].startCash)"), "ForecastChart plan tracks startCash");
assert(chartCode.includes("organicExpected = Math.round(organicWeeks[idx].startCash)"), "ForecastChart organic tracks startCash");

// Check WeekDrawer.tsx
assert(drawerCode.includes("{fmt(week.startCash)}"), "WeekDrawer uses startCash in formatting");
assert(drawerCode.includes("Beginning Cash</p>"), "WeekDrawer label is Beginning Cash");
assert(drawerCode.includes(">Beginning</p>"), "WeekDrawer math starts with Beginning");
assert(drawerCode.includes("const isBelowBuffer = distFromBuffer < 0;"), "WeekDrawer buffer warning uses distFromBuffer");
assert(drawerCode.includes("const distFromBuffer = week.endCashExpected - bufferTarget;"), "WeekDrawer buffer warning evaluates endCashExpected against bufferTarget");

console.log("All Slice 5B constraints verified.");
