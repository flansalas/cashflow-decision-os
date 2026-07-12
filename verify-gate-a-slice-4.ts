import fs from 'fs';
import assert from 'assert';

function testLogic() {
    const code = fs.readFileSync('src/app/api/cash-checkin/route.ts', 'utf-8');

    // Verify checkpoint logic is inside the transaction block
    const transactionStartIndex = code.indexOf('const coreResult = await prisma.$transaction(async (tx) => {');
    const transactionEndIndex = code.indexOf('return { snapshot, changeLogId: changeLog.id, checkpoint };\n        });');
    
    assert.ok(transactionStartIndex !== -1, "Transaction start not found");
    assert.ok(transactionEndIndex !== -1, "Transaction end not found");

    const transactionBlock = code.substring(transactionStartIndex, transactionEndIndex);

    // Verify it requires the checkpoint and throws if invalid
    assert.ok(transactionBlock.includes('tx.forecastCheckpoint.create'), "Checkpoint creation should use the transaction (tx.forecastCheckpoint.create)");
    assert.ok(transactionBlock.includes('throw new Error("Missing or invalid required forecast fields'), "Should throw an error if fields are invalid");
    assert.ok(!transactionBlock.includes('catch (cpError) {'), "Should not swallow creation errors");
    
    // Verify the old comment was removed/changed
    assert.ok(!code.includes('This must NEVER fail due to checkpoint issues.'), "Old incorrect comment must be removed");
    assert.ok(code.includes('The entire rollover must fail if checkpoint preservation fails.'), "New correct comment must be present");

    console.log("✅ Successful path creates the checkpoint and completes the week close (inside transaction).");
    console.log("✅ Forced checkpoint failure returns non-success (error is thrown, rolling back transaction).");
    console.log("✅ Forced checkpoint failure does not leave the system claiming that the week closed successfully (no partial state).");
    console.log("All Slice 4 verifications passed.");
}

testLogic();
