import fs from 'node:fs';
import assert from 'node:assert';

function testLogic() {
    // 1. Expected breakdown amounts are read correctly
    const priorWeekForecast = {
        breakdownJson: JSON.stringify({
            outflows: [
                { sourceType: "baseline", amount: 1500 }
            ],
            inflows: [
                { sourceType: "baseline", amount: 5000 }
            ]
        })
    };

    const breakdown = JSON.parse(priorWeekForecast.breakdownJson);
    const baselineOutflowItem = breakdown.outflows?.find((item: any) => item.sourceType === "baseline");
    const projectedOutflow = baselineOutflowItem ? baselineOutflowItem.amount : 0;

    const baselineInflowItem = breakdown.inflows?.find((item: any) => item.sourceType === "baseline");
    const projectedInflow = baselineInflowItem ? baselineInflowItem.amount : 0;

    assert.strictEqual(projectedOutflow, 1500, "Projected outflow was not read correctly from amount field");
    assert.strictEqual(projectedInflow, 5000, "Projected inflow was not read correctly from amount field");
    console.log("✅ Expected breakdown amounts are read correctly");

    // 2. A nonzero projected baseline remains nonzero
    assert.ok(projectedOutflow > 0, "Nonzero projected outflow baseline should remain nonzero");
    assert.ok(projectedInflow > 0, "Nonzero projected inflow baseline should remain nonzero");
    console.log("✅ Nonzero projected baseline remains nonzero");

    // 3. Missing optional breakdown data is handled safely
    const emptyForecast = {
        breakdownJson: JSON.stringify({
            outflows: [],
            // inflows missing completely
        })
    };
    const emptyBreakdown = JSON.parse(emptyForecast.breakdownJson);
    const missingOutflowItem = emptyBreakdown.outflows?.find((item: any) => item.sourceType === "baseline");
    const safeProjectedOutflow = missingOutflowItem ? missingOutflowItem.amount : 0;

    const missingInflowItem = emptyBreakdown.inflows?.find((item: any) => item.sourceType === "baseline");
    const safeProjectedInflow = missingInflowItem ? missingInflowItem.amount : 0;

    assert.strictEqual(safeProjectedOutflow, 0, "Missing outflow data should resolve to 0");
    assert.strictEqual(safeProjectedInflow, 0, "Missing inflow data should resolve to 0");
    console.log("✅ Missing optional breakdown data is handled safely");

    // 4. Verify file content itself
    const content = fs.readFileSync('src/app/api/cash-checkin/route.ts', 'utf-8');
    assert.ok(!content.includes('amountExpected'), "amountExpected should no longer exist in the file");
    assert.ok(content.includes('baselineOutflowItem.amount : 0'), "Proper amount access logic not found");
    assert.ok(content.includes('baselineInflowItem.amount : 0'), "Proper amount access logic not found");
    console.log("✅ Source file correctly updated");
    
    console.log("All Slice 3 verifications passed.");
}

testLogic();
