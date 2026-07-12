import fs from "fs";
import path from "path";

// Verify Slice 5 statically without hitting the database

function verify() {
    console.log("Verifying Slice 5 Implementation statically...");
    let passed = true;

    // 1. Verify schema.prisma
    const schemaPath = path.join(__dirname, "../prisma/schema.prisma");
    const schema = fs.readFileSync(schemaPath, "utf-8");

    if (!schema.includes('executionPlanId     String?')) {
        console.error("❌ ActionItem is missing executionPlanId field");
        passed = false;
    }
    if (!schema.includes('ownerName           String?')) {
        console.error("❌ ActionItem is missing ownerName field");
        passed = false;
    }
    if (!schema.includes('dueDate             DateTime?')) {
        console.error("❌ ActionItem is missing dueDate field");
        passed = false;
    }
    if (!schema.includes('status              String    @default("planned")')) {
        console.error("❌ ActionItem is missing status field");
        passed = false;
    }
    if (!schema.includes('actionItems        ActionItem[]')) {
        console.error("❌ ExecutionPlan is missing actionItems relation");
        passed = false;
    }
    if (!schema.includes('executionPlan ExecutionPlan? @relation(fields: [executionPlanId]')) {
        console.error("❌ ActionItem is missing executionPlan relation");
        passed = false;
    }
    if (!schema.includes('@@index([executionPlanId])') || !schema.includes('@@index([companyId, status])')) {
        console.error("❌ ActionItem is missing new indexes");
        passed = false;
    }
    if (!schema.includes('// Convention for amountImpact:')) {
        console.error("❌ ActionItem is missing signed cash effect documentation");
        passed = false;
    }
    console.log("✅ Schema fields and relations are present.");

    // 2. Verify API validation
    const apiPath = path.join(__dirname, "../src/app/api/execution-plan/route.ts");
    const apiCode = fs.readFileSync(apiPath, "utf-8");

    if (!apiCode.includes('if (!a.ownerName || !a.dueDate')) {
        console.error("❌ API route doesn't validate action owner/dueDate");
        passed = false;
    }
    if (!apiCode.includes('actionItems: {') || !apiCode.includes('create: validActions.map')) {
        console.error("❌ API route doesn't create actions within the plan transaction");
        passed = false;
    }
    if (!apiCode.includes('include: { actionItems: true }')) {
        console.error("❌ GET route doesn't include action items");
        passed = false;
    }
    console.log("✅ API route correctly validates actions and creates them in transaction.");

    // 3. Verify Modal payload
    const modalPath = path.join(__dirname, "../src/ui/ExecutionPlanModal.tsx");
    const modalCode = fs.readFileSync(modalPath, "utf-8");

    if (!modalCode.includes('ownerName: defaultOwner')) {
        console.error("❌ Modal doesn't map ownerName into actions payload");
        passed = false;
    }
    if (!modalCode.includes('dueDate: defaultDueDate')) {
        console.error("❌ Modal doesn't map dueDate into actions payload");
        passed = false;
    }
    if (!modalCode.includes('actions.push({')) {
        console.error("❌ Modal doesn't construct actions array");
        passed = false;
    }
    if (!modalCode.includes('hasActions && (!defaultOwner || !defaultDueDate)')) {
        console.error("❌ Modal doesn't allow empty action list approval");
        passed = false;
    }
    if (!modalCode.includes('source: "holdItems"')) {
        console.error("❌ Modal doesn't persist Hold List actions");
        passed = false;
    }
    if (!modalCode.includes('amountImpact: -Math.abs(') || !modalCode.includes('amountImpact: Math.abs(') || !modalCode.includes('isAR ? -Math.abs(item.amountOpen) : Math.abs(item.amountOpen)')) {
        console.error("❌ Modal doesn't map signed cash effects correctly");
        passed = false;
    }
    console.log("✅ UI modal builds actions array with signed impacts, hold items, and owner/date constraints.");

    if (!passed) {
        process.exit(1);
    }
    console.log("\n✅ ALL STATIC CONTRACT VERIFICATIONS PASSED");
    console.log("Note: Runtime migration verification is still pending.");
}

verify();
